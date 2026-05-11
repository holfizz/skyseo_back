import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { TelegramService } from '../telegram/telegram.service'
import { PrismaService } from '../prisma/prisma.service'
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
	) {}

	async create(userId: string, userEmail: string, dto: CreateWebsiteDto) {
		validateWebsiteUrl(dto.url)

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

		return this.prisma.website.update({
			where: { id },
			data: dto,
		})
	}

	async delete(id: string, userId: string) {
		await this.findOne(id, userId)

		return this.prisma.website.delete({
			where: { id },
		})
	}
}
