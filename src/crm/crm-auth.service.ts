import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	ServiceUnavailableException,
	UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { CrmRole, CrmUser } from '@prisma/client'
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'

export interface CrmJwtPayload {
	sub: string
	tg: string
	role: CrmRole
	aud: 'crm'
}

interface TgUser {
	id: string
	firstName?: string
	lastName?: string
	username?: string
	photoUrl?: string
}

/**
 * Аутентификация CRM Mini App. Вход только через Telegram (валидация initData по
 * HMAC токена CRM-бота) + вайтлист TG-id из env. В деве доступен обход (devLogin),
 * который жёстко запрещён в проде.
 */
@Injectable()
export class CrmAuthService {
	private readonly MAX_AUTH_AGE_S = 24 * 60 * 60 // initData не старше суток (анти-реплей)

	constructor(
		private config: ConfigService,
		private jwt: JwtService,
		private prisma: PrismaService,
	) {}

	private idList(key: string): string[] {
		return String(this.config.get(key) || '')
			.split(',')
			.map(s => s.trim())
			.filter(Boolean)
	}

	// ADMIN если id в списке админов, EMPLOYEE если в списке сотрудников, иначе null (доступ запрещён).
	resolveRole(telegramId: string): CrmRole | null {
		const id = String(telegramId).trim()
		if (this.idList('CRM_ADMIN_TELEGRAM_IDS').includes(id)) return 'ADMIN'
		if (this.idList('CRM_MEMBER_TELEGRAM_IDS').includes(id)) return 'EMPLOYEE'
		return null
	}

	// Валидация initData Telegram WebApp. Бросает 401 при любой нестыковке.
	private validateInitData(initData: string): TgUser {
		const token = this.config.get<string>('TELEGRAM_CRM_BOT_TOKEN')
		if (!token) throw new UnauthorizedException('CRM bot не настроен')
		if (!initData || typeof initData !== 'string')
			throw new UnauthorizedException('Нет initData')

		const params = new URLSearchParams(initData)
		const hash = params.get('hash')
		if (!hash) throw new UnauthorizedException('Нет hash')
		params.delete('hash')
		params.delete('signature') // Telegram 8.0+: signature не входит в data_check_string

		const dataCheckString = [...params.entries()]
			.map(([k, v]) => `${k}=${v}`)
			.sort()
			.join('\n')

		const secretKey = createHmac('sha256', 'WebAppData').update(token).digest()
		const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

		const a = Buffer.from(computed, 'hex')
		const b = Buffer.from(hash, 'hex')
		if (a.length !== b.length || !timingSafeEqual(a, b)) {
			throw new UnauthorizedException('Подпись initData неверна')
		}

		const authDate = Number(params.get('auth_date') || 0)
		if (!authDate || Date.now() / 1000 - authDate > this.MAX_AUTH_AGE_S) {
			throw new UnauthorizedException('initData истёк')
		}

		const userRaw = params.get('user')
		if (!userRaw) throw new UnauthorizedException('Нет user в initData')
		let u: any
		try {
			u = JSON.parse(userRaw)
		} catch {
			throw new UnauthorizedException('Некорректный user json')
		}
		if (!u?.id) throw new UnauthorizedException('Нет user.id')
		return {
			id: String(u.id),
			firstName: u.first_name,
			lastName: u.last_name,
			username: u.username,
			photoUrl: u.photo_url,
		}
	}

	async loginWithInitData(initData: string): Promise<{ token: string; user: CrmUser }> {
		return this.finishLogin(this.validateInitData(initData))
	}

	// Валидация данных Telegram Login Widget (вход с сайта в браузере).
	// ВНИМАНИЕ: схема отличается от Mini App — secret = SHA256(token) (не HMAC "WebAppData").
	private validateLoginWidget(data: Record<string, any>): TgUser {
		const token = this.config.get<string>('TELEGRAM_CRM_BOT_TOKEN')
		if (!token) throw new UnauthorizedException('CRM bot не настроен')
		const hash = data?.hash
		if (!hash || typeof hash !== 'string') throw new UnauthorizedException('Нет hash')

		const dataCheckString = Object.keys(data)
			.filter(k => k !== 'hash' && data[k] !== undefined && data[k] !== null)
			.sort()
			.map(k => `${k}=${data[k]}`)
			.join('\n')

		const secretKey = createHash('sha256').update(token).digest()
		const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

		const a = Buffer.from(computed, 'hex')
		const b = Buffer.from(hash, 'hex')
		if (a.length !== b.length || !timingSafeEqual(a, b)) {
			throw new UnauthorizedException('Подпись входа неверна')
		}

		const authDate = Number(data.auth_date || 0)
		if (!authDate || Date.now() / 1000 - authDate > this.MAX_AUTH_AGE_S) {
			throw new UnauthorizedException('Данные входа истекли')
		}
		if (!data.id) throw new UnauthorizedException('Нет id')
		return {
			id: String(data.id),
			firstName: data.first_name,
			lastName: data.last_name,
			username: data.username,
			photoUrl: data.photo_url,
		}
	}

	async loginWithWidget(data: Record<string, any>): Promise<{ token: string; user: CrmUser }> {
		return this.finishLogin(this.validateLoginWidget(data))
	}

	// Dev-обход: вход как CRM_DEV_TELEGRAM_ID без Telegram. Только вне продакшена.
	async devLogin(): Promise<{ token: string; user: CrmUser }> {
		if (this.config.get('NODE_ENV') === 'production') {
			throw new ForbiddenException('Dev-вход выключен в продакшене')
		}
		const devId = String(this.config.get('CRM_DEV_TELEGRAM_ID') || '').trim()
		if (!devId) throw new BadRequestException('CRM_DEV_TELEGRAM_ID не задан')
		return this.finishLogin({ id: devId, firstName: 'Dev' })
	}

	private async finishLogin(tg: TgUser): Promise<{ token: string; user: CrmUser }> {
		if (this.config.get('CRM_ENABLED') === 'false') {
			throw new ServiceUnavailableException('CRM временно отключена')
		}
		const role = this.resolveRole(tg.id)
		if (!role) throw new ForbiddenException('Вас нет в вайтлисте CRM')

		const user = await this.prisma.crmUser.upsert({
			where: { telegramId: tg.id },
			create: {
				telegramId: tg.id,
				firstName: tg.firstName,
				lastName: tg.lastName,
				username: tg.username,
				photoUrl: tg.photoUrl,
				role,
				lastSeenAt: new Date(),
			},
			update: {
				firstName: tg.firstName,
				lastName: tg.lastName,
				username: tg.username,
				photoUrl: tg.photoUrl,
				role, // env — источник правды по роли
				isActive: true,
				lastSeenAt: new Date(),
			},
		})

		const payload: CrmJwtPayload = {
			sub: user.id,
			tg: user.telegramId,
			role: user.role,
			aud: 'crm',
		}
		const token = this.jwt.sign(payload, {
			secret: this.config.get('JWT_SECRET'),
			expiresIn: '30d',
		})
		return { token, user }
	}

	// Проверка Bearer-токена для гварда. Роль всегда сверяется с текущим вайтлистом env,
	// поэтому удаление из env моментально отзывает доступ.
	async verifyToken(token: string): Promise<CrmUser> {
		if (this.config.get('CRM_ENABLED') === 'false') {
			throw new ServiceUnavailableException('CRM временно отключена')
		}
		let payload: CrmJwtPayload
		try {
			payload = this.jwt.verify(token, { secret: this.config.get('JWT_SECRET') })
		} catch {
			throw new UnauthorizedException('Невалидный токен')
		}
		if (payload.aud !== 'crm' || !payload.sub)
			throw new UnauthorizedException('Не CRM-токен')

		const user = await this.prisma.crmUser.findUnique({ where: { id: payload.sub } })
		if (!user || !user.isActive) throw new UnauthorizedException('CRM-участник неактивен')

		const role = this.resolveRole(user.telegramId)
		if (!role) throw new UnauthorizedException('Удалён из вайтлиста CRM')
		if (role !== user.role) {
			await this.prisma.crmUser.update({ where: { id: user.id }, data: { role } })
			user.role = role
		}
		return user
	}
}
