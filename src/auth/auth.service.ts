import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { UserType } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { UsersService } from '../users/users.service'
import { LoginDto, RegisterDto } from './dto'
import { lookupPromoCode } from './promo-codes'

@Injectable()
export class AuthService {
	// Список разрешенных email доменов
	private readonly allowedEmailDomains = new Set([
		// Google
		'gmail.com',
		'googlemail.com',
		// Microsoft
		'outlook.com',
		'hotmail.com',
		'live.com',
		'msn.com',
		// Yandex
		'yandex.ru',
		'yandex.com',
		'ya.ru',
		'yandex.by',
		'yandex.kz',
		'yandex.ua',
		// Mail.ru Group
		'mail.ru',
		'inbox.ru',
		'list.ru',
		'bk.ru',
		// Rambler
		'rambler.ru',
		'lenta.ru',
		'autorambler.ru',
		'myrambler.ru',
		'ro.ru',
		// Yahoo
		'yahoo.com',
		'yahoo.co.uk',
		'yahoo.fr',
		'yahoo.de',
		'yahoo.es',
		'yahoo.it',
		// Apple
		'icloud.com',
		'me.com',
		'mac.com',
		// Популярные международные
		'protonmail.com',
		'tutanota.com',
		'zoho.com',
		'aol.com',
		// Немецкие
		'gmx.de',
		'web.de',
		't-online.de',
		'freenet.de',
		// Французские
		'orange.fr',
		'wanadoo.fr',
		'free.fr',
		'laposte.net',
		// Итальянские
		'libero.it',
		'virgilio.it',
		'alice.it',
		'tin.it',
		// Испанские
		'terra.es',
		'telefonica.net',
		'ya.com',
		// Польские
		'wp.pl',
		'onet.pl',
		'interia.pl',
		'gazeta.pl',
		// Чешские
		'seznam.cz',
		'centrum.cz',
		'email.cz',
		// Украинские
		'ukr.net',
		'i.ua',
		'bigmir.net',
		'meta.ua',
		// Белорусские
		'tut.by',
		'mail.by',
		// Казахские
		'mail.kz',
		'inbox.kz',
		// Другие популярные
		'fastmail.com',
		'hushmail.com',
		'guerrillamail.com',
		'10minutemail.com',
		'mailinator.com',
		'tempmail.org',

		// Образовательные
		'edu',
		'ac.uk',
		'edu.ru',
		'student.ru',
		// Региональные российские
		'spb.ru',
		'msk.ru',
		'ngs.ru',
		'e1.ru',
		'74.ru',
		'96.ru',
		// Дополнительные международные
		'rediffmail.com',
		'indiatimes.com',
		'sify.com', // Индия
		'163.com',
		'126.com',
		'qq.com',
		'sina.com', // Китай
		'naver.com',
		'daum.net',
		'hanmail.net', // Корея
		'goo.ne.jp',
		'so-net.ne.jp',
		'nifty.com', // Япония
		'bol.com.br',
		'uol.com.br',
		'ig.com.br', // Бразилия
		'terra.com.br',
		'globo.com',
		'r7.com',
		// Дополнительные европейские
		'bluewin.ch',
		'sunrise.ch', // Швейцария
		'chello.nl',
		'planet.nl',
		'xs4all.nl', // Нидерланды
		'skynet.be',
		'belgacom.net', // Бельгия
		'eircom.net',
		'indigo.ie', // Ирландия
		'telenet.be',
		'pandora.be',
		// Скандинавские
		'telia.com',
		'spray.se',
		'passagen.se', // Швеция
		'online.no',
		'start.no', // Норвегия
		'jubii.dk',
		'post.dk', // Дания
		'suomi24.fi',
		'luukku.com', // Финляндия
	])

	constructor(
		private usersService: UsersService,
		private jwtService: JwtService,
		private telegramService: TelegramService,
		private notificationsService: NotificationsService,
		private prisma: PrismaService,
	) {}

	private validateEmailDomain(email: string): void {
		const domain = email.split('@')[1]?.toLowerCase()

		if (!domain) {
			throw new BadRequestException('Некорректный email адрес')
		}

		if (!this.allowedEmailDomains.has(domain)) {
			throw new BadRequestException(
				`Регистрация с корпоративных и неподтвержденных почтовых доменов временно ограничена. Пожалуйста, используйте личную почту с проверенных сервисов: gmail.com, yandex.ru, mail.ru, outlook.com и других популярных почтовых провайдеров.`,
			)
		}
	}

	async register(dto: RegisterDto, ipAddress?: string) {
		// Валидация email домена
		this.validateEmailDomain(dto.email)

		// Защита от одноразовых email
		const disposableEmailDomains = [
			'tempmail.com',
			'guerrillamail.com',
			'10minutemail.com',
			'throwaway.email',
			'mailinator.com',
		]
		const emailDomain = dto.email.split('@')[1]?.toLowerCase()
		if (disposableEmailDomains.includes(emailDomain)) {
			throw new ConflictException('Disposable email addresses are not allowed')
		}

		const existingUser = await this.usersService.findByEmail(dto.email)
		if (existingUser) {
			throw new ConflictException('Email already registered')
		}

		// Защита от множественных регистраций с одного IP
		if (ipAddress) {
			const recentRegistrations =
				await this.usersService.countRecentRegistrationsByIp(ipAddress)
			if (recentRegistrations > 3) {
				throw new ConflictException(
					'Too many registrations from this IP address',
				)
			}
		}

		const hashedPassword = await bcrypt.hash(dto.password, 8)

		// Генерируем токен для подтверждения email
		const emailVerificationToken = randomBytes(32).toString('hex')

		// Генерируем уникальный реферальный код
		const referralCode = randomBytes(4).toString('hex').toUpperCase()

		// Единое поле «промокод или код друга»: одно значение может быть промокодом
		// (бонус новичку + трекинг канала) ИЛИ реф-кодом друга. App шлёт одно поле,
		// web — promoCode; берём любое присланное.
		const enteredCode = (dto.referralCode || dto.promoCode)?.trim().toUpperCase() || undefined

		// Промокод — если введённое совпало с активным промокодом
		const promo = await lookupPromoCode(this.prisma, enteredCode)

		// Реферал (кто пригласил): код в поле, если это реф-код; иначе фоллбэк по IP.
		// При переходе по реф-ссылке /?ref=CODE мы записали PageEvent с ref и IP.
		// Скачивание и регистрация идут с одной машины/сети → публичный IP тот же,
		// находим последний реф-клик с этого IP за 72ч.
		let referredBy: string | undefined
		const resolveReferrer = async (code?: string) => {
			if (!code || referredBy) return
			const referrer = await this.prisma.user.findUnique({
				where: { referralCode: code },
				select: { id: true },
			})
			if (referrer) referredBy = referrer.id
		}
		await resolveReferrer(enteredCode)
		if (!referredBy && ipAddress) {
			const recentClick = await this.prisma.pageEvent.findFirst({
				where: {
					ref: { not: null },
					ip: ipAddress,
					createdAt: { gte: new Date(Date.now() - 72 * 60 * 60 * 1000) },
				},
				orderBy: { createdAt: 'desc' },
				select: { ref: true },
			})
			await resolveReferrer(recentClick?.ref?.trim().toUpperCase())
		}

		const userTypeMap: Record<string, string> = {
			marketer: 'MARKETER',
			seo: 'SEO',
			entrepreneur: 'ENTREPRENEUR',
			startup: 'STARTUP',
		}
		const userTypeLabelMap: Record<string, string> = {
			MARKETER: 'Маркетолог',
			SEO: 'SEO специалист',
			ENTREPRENEUR: 'Предприниматель',
			STARTUP: 'Стартапер',
		}
		const mappedUserType = dto.role ? userTypeMap[dto.role.toLowerCase()] as UserType : undefined

		const user = await this.usersService.create({
			email: dto.email,
			password: hashedPassword,
			referralSource: dto.referralSource,
			referralCode,
			referredBy,
			promoCode: promo?.code,
			city: dto.city || this.getCityFromIp(ipAddress),
			lastLoginIp: ipAddress,
			registrationIp: ipAddress,
			emailVerificationToken,
			appVersion: dto.appVersion,
			// Регистрация из приложения (есть appVersion) → сразу ACTIVE, иначе дефолт NEVER (веб)
			appStatus: dto.appVersion ? 'ACTIVE' : undefined,
			userType: mappedUserType,
			telegramContact: dto.telegram?.trim() || undefined,
		})

		// Бонус по промокоду — отдельная запись в balance_history для отчётности
		if (promo) {
			await this.prisma.user.update({
				where: { id: user.id },
				data: { balance: { increment: promo.bonusPoints } },
			})
			await this.prisma.balanceHistory.create({
				data: {
					userId: user.id,
					amount: promo.bonusPoints,
					type: 'REFERRAL_BONUS',
					description: `Промокод ${promo.code}${promo.description ? ': ' + promo.description : ''}`,
				},
			})
		}

		const userTypeLabel = mappedUserType ? (userTypeLabelMap[mappedUserType] || mappedUserType) : 'Не указана'

		// Уведомления отправляем в фоне — не блокируем ответ
		this.telegramService.sendRegistrationNotification(
			user.email,
			user.city || 'Не указан',
			user.referralSource || 'Не указан',
			ipAddress || 'Не определен',
			user.balance,
			userTypeLabel,
			user.promoCode || undefined,
		).catch(err => console.error('[AuthService] Telegram notification failed:', err.message))

		this.notificationsService.sendWelcomeAndVerificationEmail(
			user.email,
			emailVerificationToken,
		).catch(err => console.error('[AuthService] Welcome email failed:', err.message))

		const token = this.generateToken(user.id, user.email)

		return {
			user: this.sanitizeUser(user),
			token,
		}
	}

	async login(dto: LoginDto) {
		const user = await this.usersService.findByEmail(dto.email)
		if (!user) {
			await this.usersService.incrementFailedLogin(dto.email)
			throw new UnauthorizedException('Invalid credentials')
		}

		const isPasswordValid = await bcrypt.compare(dto.password, user.password)
		if (!isPasswordValid) {
			await this.usersService.incrementFailedLogin(dto.email)
			throw new UnauthorizedException('Invalid credentials')
		}

		if (!user.isActive) {
			throw new UnauthorizedException('Account is disabled')
		}

		// Не блокируем ответ — обновляем в фоне
		this.usersService.resetFailedLogin(user.id).catch(() => {})
		if (dto.appVersion) {
			// Логин с приложения → отслеживаем статус установки
			const updateData: any = {
				appVersion: dto.appVersion,
				appLastLoginAt: new Date(), // Последний логин с приложения
			}
			if (user.appStatus === 'UNINSTALLED') {
				updateData.appStatus = 'REINSTALLED'
			} else if (user.appStatus !== 'ACTIVE') {
				updateData.appStatus = 'ACTIVE'
			}
			this.prisma.user.update({
				where: { id: user.id },
				data: updateData,
			}).catch(() => {})
		}

		const token = this.generateToken(user.id, user.email)

		return {
			user: this.sanitizeUser(user),
			token,
		}
	}

	private generateToken(userId: string, email: string): string {
		return this.jwtService.sign({ sub: userId, email })
	}

	private sanitizeUser(user: any) {
		const { password, ...result } = user
		return result
	}

	private getCityFromIp(ipAddress?: string): string {
		// TODO: Интеграция с IP геолокацией
		return 'Не определен'
	}

	async forgotPassword(email: string) {
		const user = await this.usersService.findByEmail(email)
		if (!user) {
			// Не раскрываем информацию о существовании email
			return {
				message: 'Если email существует, письмо с инструкциями отправлено',
			}
		}

		// Генерируем токен
		const resetToken = randomBytes(32).toString('hex')
		const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 час

		// Сохраняем токен в базе
		await this.prisma.passwordResetToken.create({
			data: {
				userId: user.id,
				token: resetToken,
				expiresAt,
			},
		})

		this.notificationsService.sendPasswordResetEmail(email, resetToken)
			.catch(err => console.error('[AuthService] Password reset email failed:', err.message))

		return {
			message: 'Если email существует, письмо с инструкциями отправлено',
		}
	}

	async resetPassword(token: string, newPassword: string) {
		// Находим токен
		const resetToken = await this.prisma.passwordResetToken.findUnique({
			where: { token },
			include: { user: true },
		})

		if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
			throw new BadRequestException('Недействительный или истекший токен')
		}

		// Хешируем новый пароль
		const hashedPassword = await bcrypt.hash(newPassword, 10)

		// Обновляем пароль пользователя
		await this.prisma.user.update({
			where: { id: resetToken.userId },
			data: { password: hashedPassword },
		})

		// Помечаем токен как использованный
		await this.prisma.passwordResetToken.update({
			where: { id: resetToken.id },
			data: { used: true },
		})

		console.log(
			`[AuthService] Password reset successful for user: ${resetToken.user.id.substring(0, 8)}***`,
		)

		return { message: 'Пароль успешно изменен' }
	}

	async verifyEmail(token: string) {
		const user = await this.prisma.user.findUnique({
			where: { emailVerificationToken: token },
		})

		if (!user) {
			throw new BadRequestException('Недействительный токен подтверждения')
		}

		if (user.emailVerified) {
			return { message: 'Email уже подтвержден', alreadyVerified: true }
		}

		await this.prisma.user.update({
			where: { id: user.id },
			data: {
				emailVerified: true,
				emailVerificationToken: null,
			},
		})

		console.log(
			`[AuthService] Email verified for user: ${user.id.substring(0, 8)}***`,
		)

		return { message: 'Email успешно подтвержден' }
	}

	async resendVerificationEmail(userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
		})

		if (!user) {
			throw new NotFoundException('Пользователь не найден')
		}

		if (user.emailVerified) {
			return {
				success: true,
				message: 'Email уже подтвержден',
				alreadyVerified: true,
			}
		}

		// Генерируем новый токен
		const emailVerificationToken = randomBytes(32).toString('hex')

		await this.prisma.user.update({
			where: { id: userId },
			data: { emailVerificationToken },
		})

		this.notificationsService.sendEmailVerification(
			user.email,
			emailVerificationToken,
		).catch(err => console.error('[AuthService] Verification email failed:', err.message))

		return {
			success: true,
			message: 'Письмо с подтверждением отправлено повторно',
			alreadyVerified: false,
		}
	}
}
