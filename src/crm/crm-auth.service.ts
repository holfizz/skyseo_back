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
import * as bcrypt from 'bcrypt'
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { hasRole, hasRoleStrict } from '../common/roles'
import { PrismaService } from '../prisma/prisma.service'

export interface CrmJwtPayload {
	sub: string
	tg?: string // может отсутствовать: вход по email+паролю, Telegram ещё не привязан
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
 * Аутентификация CRM. Основной вход — email + пароль аккаунта платформы; роль в CRM
 * выводится из User.roles. Telegram — второй способ входа для уже привязанного профиля
 * (валидация initData/Login Widget по HMAC токена CRM-бота). В деве доступен обход
 * (devLogin), который жёстко запрещён в проде.
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

	// Роль в CRM по аккаунту платформы. null = доступа нет (выключён или снята рабочая роль).
	private async roleFromPlatform(userId: string): Promise<CrmRole | null> {
		const account = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { isActive: true, role: true, roles: true },
		})
		if (!account || !account.isActive) return null
		if (!hasRole(account, 'MANAGER', 'SMM')) return null
		return hasRoleStrict(account, 'ADMIN') ? 'ADMIN' : 'EMPLOYEE'
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

	/**
	 * ОСНОВНОЙ вход в CRM: email + пароль аккаунта платформы.
	 * Роль берётся из User.roles (не из env-вайтлиста): ADMIN платформы → ADMIN в CRM,
	 * MANAGER/SMM → EMPLOYEE. Пользователь без рабочей роли в CRM не пускается.
	 * Профиль CrmUser создаётся автоматически при первом входе и связывается с userId.
	 */
	async loginWithPassword(email: string, password: string): Promise<{ token: string; user: CrmUser }> {
		if (this.config.get('CRM_ENABLED') === 'false') {
			throw new ServiceUnavailableException('CRM временно отключена')
		}
		const account = await this.prisma.user.findUnique({
			where: { email: String(email || '').trim().toLowerCase() },
			select: { id: true, email: true, password: true, isActive: true, role: true, roles: true },
		})
		// Единое сообщение на «нет юзера» и «неверный пароль» — не подсказываем, какие email существуют.
		if (!account) throw new UnauthorizedException('Неверный email или пароль')
		const ok = await bcrypt.compare(password || '', account.password)
		if (!ok) throw new UnauthorizedException('Неверный email или пароль')
		if (!account.isActive) throw new ForbiddenException('Аккаунт отключён')

		// В CRM пускаем только сотрудников. Обычный клиент сюда не попадёт.
		if (!hasRole(account, 'MANAGER', 'SMM')) {
			throw new ForbiddenException('Нет доступа в CRM')
		}
		const role: CrmRole = hasRoleStrict(account, 'ADMIN') ? 'ADMIN' : 'EMPLOYEE'

		const user = await this.prisma.crmUser.upsert({
			where: { userId: account.id },
			create: {
				userId: account.id,
				email: account.email,
				role,
				lastSeenAt: new Date(),
			},
			update: {
				email: account.email,
				role, // платформа — источник правды по роли
				isActive: true,
				lastSeenAt: new Date(),
			},
		})
		return { token: this.signToken(user), user }
	}

	/**
	 * Привязка Telegram к уже существующему профилю CRM — чтобы приходили уведомления
	 * и можно было заходить с телефона без пароля. Вызывается изнутри CRM (с токеном).
	 */
	async linkTelegram(crmUserId: string, initData: string): Promise<CrmUser> {
		const tg = this.validateInitData(initData)
		const busy = await this.prisma.crmUser.findUnique({ where: { telegramId: tg.id } })
		if (busy && busy.id !== crmUserId) {
			throw new BadRequestException('Этот Telegram уже привязан к другому сотруднику')
		}
		return this.prisma.crmUser.update({
			where: { id: crmUserId },
			data: {
				telegramId: tg.id,
				firstName: tg.firstName,
				lastName: tg.lastName,
				username: tg.username,
				photoUrl: tg.photoUrl,
			},
		})
	}

	/** Отвязать Telegram (например, сотрудник сменил аккаунт). */
	async unlinkTelegram(crmUserId: string): Promise<CrmUser> {
		return this.prisma.crmUser.update({
			where: { id: crmUserId },
			data: { telegramId: null, photoUrl: null, username: null },
		})
	}

	private signToken(user: CrmUser): string {
		const payload: CrmJwtPayload = {
			sub: user.id,
			tg: user.telegramId ?? undefined,
			role: user.role,
			aud: 'crm',
		}
		return this.jwt.sign(payload, {
			secret: this.config.get('JWT_SECRET'),
			expiresIn: '30d',
		})
	}

	private async finishLogin(tg: TgUser): Promise<{ token: string; user: CrmUser }> {
		if (this.config.get('CRM_ENABLED') === 'false') {
			throw new ServiceUnavailableException('CRM временно отключена')
		}

		// Telegram — ВТОРОЙ способ входа, а не отдельная дверь. Пускаем только тех, кто уже
		// завёл профиль через email+пароль и привязал этот Telegram. Иначе достаточно было бы
		// попасть в env-вайтлист, чтобы получить доступ в обход аккаунта платформы.
		const user = await this.prisma.crmUser.findUnique({ where: { telegramId: tg.id } })
		if (!user) {
			throw new ForbiddenException(
				'Telegram не привязан. Войдите по email и паролю, затем привяжите Telegram в профиле.',
			)
		}
		if (!user.isActive) throw new ForbiddenException('Доступ отключён')

		const fresh = await this.prisma.crmUser.update({
			where: { id: user.id },
			data: {
				firstName: tg.firstName,
				lastName: tg.lastName,
				username: tg.username,
				photoUrl: tg.photoUrl,
				lastSeenAt: new Date(),
			},
		})
		return { token: this.signToken(fresh), user: fresh }
	}

	/**
	 * Проверка Bearer-токена для гварда. Роль пересчитывается на КАЖДОМ запросе,
	 * поэтому отзыв доступа срабатывает мгновенно, без перевыпуска токена.
	 *
	 * Источник правды — аккаунт платформы (User.roles): снял роль или выключил
	 * аккаунт → сотрудник тут же теряет CRM. Env-вайтлист остался только для старых
	 * профилей, заведённых через Telegram до входа по паролю (у них нет userId).
	 */
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

		const role = user.userId
			? await this.roleFromPlatform(user.userId)
			: this.resolveRole(user.telegramId ?? '')
		if (!role) throw new UnauthorizedException('Доступ в CRM отозван')
		if (role !== user.role) {
			await this.prisma.crmUser.update({ where: { id: user.id }, data: { role } })
			user.role = role
		}
		return user
	}
}
