import { BadRequestException, Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class SmmService {
	constructor(private prisma: PrismaService) {}

	// Трекинг-ссылка для вставки в пост: код поста едет в utm_campaign,
	// его же ловим по IP при регистрации (см. auth.service).
	private buildLink(code: string, destination: string): string {
		const base = process.env.PUBLIC_SITE_URL || 'https://skyseo.site'
		const path = destination.startsWith('/') ? destination : `/${destination}`
		const sep = path.includes('?') ? '&' : '?'
		return `${base}${path}${sep}utm_source=telegram&utm_medium=post&utm_campaign=${encodeURIComponent(code)}`
	}

	async createPost(dto: {
		title?: string
		tgUrl?: string
		tgText?: string
		destination?: string
	}) {
		const title = dto.title?.trim()
		if (!title) throw new BadRequestException('Название обязательно')

		let destination = (dto.destination || '/').trim() || '/'
		if (!destination.startsWith('/')) destination = `/${destination}`

		// Уникальный короткий код (8 hex). Коллизии почти невозможны, но подстрахуемся.
		let code = ''
		for (let i = 0; i < 5; i++) {
			code = randomBytes(4).toString('hex')
			const exists = await this.prisma.marketingPost.findUnique({ where: { code } })
			if (!exists) break
		}

		const post = await this.prisma.marketingPost.create({
			data: {
				code,
				title,
				tgUrl: dto.tgUrl?.trim() || null,
				tgText: dto.tgText?.trim() || null,
				destination,
			},
		})
		return { ...post, link: this.buildLink(post.code, post.destination) }
	}

	// Список постов с цифрами: визиты / регистрации / оплаты / выручка.
	async listPosts() {
		const posts = await this.prisma.marketingPost.findMany({
			orderBy: { createdAt: 'desc' },
		})

		return Promise.all(
			posts.map(async post => {
				const [visits, registrations, pay] = await Promise.all([
					this.prisma.pageEvent.count({
						where: { type: 'visit', utmCampaign: post.code },
					}),
					this.prisma.user.count({ where: { marketingCode: post.code } }),
					this.prisma.payment.aggregate({
						where: { status: 'SUCCEEDED', user: { marketingCode: post.code } },
						_count: { _all: true },
						_sum: { amount: true },
					}),
				])
				return {
					id: post.id,
					code: post.code,
					title: post.title,
					tgUrl: post.tgUrl,
					destination: post.destination,
					createdAt: post.createdAt,
					link: this.buildLink(post.code, post.destination),
					visits,
					registrations,
					payments: pay._count._all,
					revenue: pay._sum.amount?.toNumber() ?? 0,
				}
			}),
		)
	}

	// Переименовать (title) и/или привязать ссылку на пост в ТГ после публикации.
	async updatePost(id: string, patch: { title?: string; tgUrl?: string }) {
		const data: { title?: string; tgUrl?: string | null } = {}
		if (patch.title !== undefined) data.title = patch.title.trim()
		if (patch.tgUrl !== undefined) data.tgUrl = patch.tgUrl.trim() || null
		const post = await this.prisma.marketingPost.update({ where: { id }, data })
		return { ...post, link: this.buildLink(post.code, post.destination) }
	}

	async deletePost(id: string) {
		await this.prisma.marketingPost.delete({ where: { id } })
		return { ok: true }
	}
}
