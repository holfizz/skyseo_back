import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { CrmCustomFieldDefinition, CrmCustomFieldType, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCustomFieldDto, UpdateCustomFieldDto } from './qualification.dto'

type ValueData = Partial<Pick<Prisma.CrmCustomFieldValueUncheckedCreateInput,
	'valueBoolean' | 'valueText' | 'valueNumber' | 'valueDate' | 'valueOptions'>>

@Injectable()
export class QualificationService {
	constructor(private readonly prisma: PrismaService) {}

	fields(includeInactive = false) {
		return this.prisma.crmCustomFieldDefinition.findMany({
			where: { entityType: 'LEAD', ...(includeInactive ? {} : { isActive: true }) },
			orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
		})
	}

	async createField(input: CreateCustomFieldDto) {
		const options = this.options(input.type, input.options || [])
		const key = input.key.trim().toLowerCase()
		const name = input.name.trim()
		if (name.length < 2) throw new BadRequestException('Название поля слишком короткое')
		if (await this.prisma.crmCustomFieldDefinition.findUnique({ where: { key } }))
			throw new BadRequestException('Ключ поля уже занят')
		return this.prisma.crmCustomFieldDefinition.create({ data: {
			key, name, type: input.type, options,
			position: input.position ?? 0, required: input.required ?? false,
		} })
	}

	async updateField(id: string, input: UpdateCustomFieldDto) {
		const existing = await this.prisma.crmCustomFieldDefinition.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Поле квалификации не найдено')
		const name = input.name?.trim()
		if (name !== undefined && name.length < 2) throw new BadRequestException('Название поля слишком короткое')
		const options = input.options === undefined ? undefined : this.options(existing.type, input.options)
		if (options && (existing.type === 'SELECT' || existing.type === 'MULTI_SELECT')) {
			const removed = existing.options.filter(option => !options.includes(option))
			if (removed.length) {
				const used = await this.prisma.crmCustomFieldValue.count({ where: {
					fieldId: id,
					OR: [{ valueText: { in: removed } }, { valueOptions: { hasSome: removed } }],
				} })
				if (used) throw new BadRequestException('Сначала замените сохранённые ответы с удаляемыми вариантами')
			}
		}
		return this.prisma.crmCustomFieldDefinition.update({ where: { id }, data: {
			...(name !== undefined ? { name } : {}),
			...(options !== undefined ? { options } : {}),
			...(input.position !== undefined ? { position: input.position } : {}),
			...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
			...(input.required !== undefined ? { required: input.required } : {}),
		} })
	}

	private options(type: CrmCustomFieldType, raw: string[]) {
		const options = [...new Set(raw.map(value => value.trim()).filter(Boolean))]
		if (options.length !== raw.length) throw new BadRequestException('Варианты должны быть непустыми и уникальными')
		if (options.some(value => value.length > 100)) throw new BadRequestException('Вариант длиннее 100 символов')
		if (type === 'SELECT' || type === 'MULTI_SELECT') {
			if (!options.length) throw new BadRequestException('Для выбора добавьте варианты ответа')
		} else if (options.length) throw new BadRequestException('Варианты нужны только для select-полей')
		return options
	}

	async leadFields(leadId: string) {
		const [fields, values] = await Promise.all([
			this.fields(),
			this.prisma.crmCustomFieldValue.findMany({ where: { leadId }, select: {
				fieldId: true, valueBoolean: true, valueText: true,
				valueNumber: true, valueDate: true, valueOptions: true,
			} }),
		])
		return { fields, values }
	}

	async saveValue(leadId: string, fieldId: string, value: unknown, actorId: string) {
		return this.prisma.$transaction(async tx => {
			await tx.$queryRaw`SELECT 1::int FROM pg_advisory_xact_lock(761904, hashtext(${`${leadId}:${fieldId}`}))`
			const [lead, field] = await Promise.all([
				tx.crmLead.findUnique({ where: { id: leadId }, select: { id: true } }),
				tx.crmCustomFieldDefinition.findUnique({ where: { id: fieldId } }),
			])
			if (!lead) throw new NotFoundException('Лид не найден')
			if (!field || !field.isActive || field.entityType !== 'LEAD')
				throw new BadRequestException('Поле недоступно')
			const data = this.parseValue(field, value)
			if (!data) {
				if (field.required) throw new BadRequestException('Обязательное поле нельзя оставить пустым')
				await tx.crmCustomFieldValue.deleteMany({ where: { leadId, fieldId } })
			} else {
				await tx.crmCustomFieldValue.upsert({ where: { fieldId_leadId: { fieldId, leadId } },
					create: { leadId, fieldId, ...data }, update: data })
			}
			await tx.crmActivity.create({ data: { actorId, action: 'lead.custom_field', entityType: 'lead', entityId: leadId, summary: `Изменено поле «${field.name}»` } })
			return { ok: true }
		})
	}

	private parseValue(field: CrmCustomFieldDefinition, raw: unknown): ValueData | null {
		if (raw === null || raw === '' || (Array.isArray(raw) && !raw.length)) return null
		switch (field.type) {
			case 'BOOLEAN':
				if (typeof raw !== 'boolean') break
				return { valueBoolean: raw }
			case 'TEXT': case 'TEXTAREA':
				if (typeof raw !== 'string' || raw.trim().length > (field.type === 'TEXT' ? 300 : 4000)) break
				return raw.trim() ? { valueText: raw.trim() } : null
			case 'NUMBER': {
				const number = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN
				if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000_000) break
				return { valueNumber: new Prisma.Decimal(number) }
			}
			case 'DATE': {
				if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) break
				const date = new Date(`${raw}T00:00:00.000Z`)
				if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) break
				return { valueDate: date }
			}
			case 'SELECT':
				if (typeof raw !== 'string' || !field.options.includes(raw)) break
				return { valueText: raw }
			case 'MULTI_SELECT':
				if (!Array.isArray(raw) || raw.length > field.options.length || raw.some(v => typeof v !== 'string' || !field.options.includes(v))) break
				return { valueOptions: [...new Set(raw)] }
		}
		throw new BadRequestException(`Некорректное значение поля «${field.name}»`)
	}
}
