import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { TelegramService } from '../telegram/telegram.service'
import { PrismaService } from '../prisma/prisma.service'
import { AppConfigService } from '../app-config/app-config.service'
import { CreateWebsiteDto, UpdateWebsiteDto } from './dto'

const URL_FORBIDDEN_WORDS = [
	'porn', 'sex', 'xxx', 'erotic', 'adult', 'casino', 'betting',
	'escort', 'слот', 'ставки', 'казино', 'порно', 'секс',
]

function validateWebsiteUrl(url: string): void {
	const lower = url.toLowerCase()
	for (const word of URL_FORBIDDEN_WORDS) {
		if (lower.includes(word)) {
			throw new BadRequestException('Сайт нарушает правила использования сервиса')
		}
	}
}

@Injectable()
export class WebsitesService {
	constructor(
		private prisma: PrismaService,
		private telegram: TelegramService,
		private appConfig: AppConfigService,
	) {}

	// Не даём владельцу поставить потолок больше, чем сейчас тянет сеть
	// (ceil(среднее активных ПК/день / 14)). null = «без явного лимита» — не трогаем.
	private async clampDailyTarget(
		target: number | null | undefined,
	): Promise<number | null | undefined> {
		if (target == null) return target
		const { maxPerDay } = await this.appConfig.getNetworkCapacityInfo()
		return Math.min(target, maxPerDay)
	}

	private async checkSiteReachable(url: string): Promise<void> {
		const normalized = url.trim().replace(/\/$/, '')
		const siteUrl = /^https?:\/\//i.test(normalized) ? normalized : 'https://' + normalized

		// Localhost пропускаем — нужен для локальной разработки
		if (/^https?:\/\/localhost(:\d+)?/i.test(siteUrl)) return

		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 8000)
		try {
			const res = await fetch(siteUrl, {
				method: 'HEAD',
				signal: controller.signal,
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SkySEO-Bot/1.0)' },
			})
			if (res.status === 404 || res.status >= 500) {
				throw new BadRequestException(`Сайт недоступен (HTTP ${res.status}). Проверьте URL.`)
			}
		} catch (err) {
			if (err instanceof BadRequestException) throw err
			throw new BadRequestException('Сайт не отвечает. Проверьте правильность URL.')
		} finally {
			clearTimeout(timeout)
		}
	}

	async create(userId: string, userEmail: string, dto: CreateWebsiteDto) {
		validateWebsiteUrl(dto.url)

		await this.checkSiteReachable(dto.url)

		// Проверка на существующий сайт с таким же URL у этого пользователя
		const existingWebsite = await this.prisma.website.findFirst({
			where: {
				userId,
				url: dto.url,
			},
		})

		if (existingWebsite) {
			throw new BadRequestException(
				'Сайт с таким URL уже существует в вашем списке',
			)
		}

		const website = await this.prisma.website.create({
			data: {
				userId,
				name: dto.name,
				url: dto.url,
				city: dto.city,
				dailyVisitsTarget: await this.clampDailyTarget(dto.dailyVisitsTarget),
				autoMaxVisits: dto.autoMaxVisits ?? false,
			},
		})

		this.telegram.sendWebsiteCreatedNotification({
			userEmail,
			websiteName: dto.name,
			websiteUrl: dto.url,
		}).catch(() => {})

		return website
	}

	async findAll(userId: string) {
		return this.prisma.website.findMany({
			where: { userId },
			orderBy: { createdAt: 'desc' },
		})
	}

	async findOne(id: string, userId: string) {
		const website = await this.prisma.website.findUnique({
			where: { id },
		})

		if (!website) {
			throw new NotFoundException('Website not found')
		}

		if (website.userId !== userId) {
			throw new ForbiddenException('Access denied')
		}

		return website
	}

	async update(id: string, userId: string, dto: UpdateWebsiteDto) {
		await this.findOne(id, userId)

		// Редактировать можно ТОЛЬКО просмотры/режим — не сам сайт (url/name).
		const data: { isActive?: boolean; autoMaxVisits?: boolean; dailyVisitsTarget?: number | null } = {}
		if (dto.isActive !== undefined) data.isActive = dto.isActive
		if (dto.autoMaxVisits !== undefined) data.autoMaxVisits = dto.autoMaxVisits
		if (dto.dailyVisitsTarget !== undefined) {
			data.dailyVisitsTarget = (await this.clampDailyTarget(dto.dailyVisitsTarget)) ?? null
		}

		return this.prisma.website.update({ where: { id }, data })
	}

	async delete(id: string, userId: string) {
		await this.findOne(id, userId)

		return this.prisma.website.delete({
			where: { id },
		})
	}
}
