import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { UsersService } from '../users/users.service'
import { LoginDto, RegisterDto } from './dto'

@Injectable()
export class AuthService {
	constructor(
		private usersService: UsersService,
		private jwtService: JwtService,
		private telegramService: TelegramService,
		private notificationsService: NotificationsService,
		private prisma: PrismaService,
	) {}

	async register(dto: RegisterDto, ipAddress?: string) {
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

		const hashedPassword = await bcrypt.hash(dto.password, 10)

		// Генерируем токен для подтверждения email
		const emailVerificationToken = randomBytes(32).toString('hex')

		const user = await this.usersService.create({
			email: dto.email,
			password: hashedPassword,
			referralSource: dto.referralSource,
			city: dto.city || this.getCityFromIp(ipAddress),
			lastLoginIp: ipAddress,
			emailVerificationToken,
		})

		// Отправка уведомления в Telegram
		await this.telegramService.sendAdminNotification(
			`🆕 Новая регистрация\n\n` +
				`Email: ${user.email}\n` +
				`Город: ${user.city || 'Не указан'}\n` +
				`Источник: ${user.referralSource || 'Не указан'}\n` +
				`Баланс: ${user.balance} баллов (приветственный бонус)`,
		)

		// Отправка приветственного email
		try {
			await this.notificationsService.sendWelcomeEmail(user.email)
			console.log(
				`[AuthService] Welcome email sent to: ${user.email.split('@')[0]}***@${user.email.split('@')[1]}`,
			)
		} catch (error) {
			console.error('[AuthService] Failed to send welcome email:', error)
		}

		// Отправка email для подтверждения
		try {
			await this.notificationsService.sendEmailVerification(
				user.email,
				emailVerificationToken,
			)
			console.log(
				`[AuthService] Verification email sent to: ${user.email.split('@')[0]}***@${user.email.split('@')[1]}`,
			)
		} catch (error) {
			console.error('[AuthService] Failed to send verification email:', error)
		}

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

		// Сброс счетчика неудачных попыток
		await this.usersService.resetFailedLogin(user.id)

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

		// Отправляем email
		try {
			await this.notificationsService.sendPasswordResetEmail(email, resetToken)
			console.log(
				`[AuthService] Password reset email sent to: ${email.split('@')[0]}***@${email.split('@')[1]}`,
			)
		} catch (error) {
			console.error('[AuthService] Failed to send password reset email:', error)
		}

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
			throw new BadRequestException('Email уже подтвержден')
		}

		// Генерируем новый токен
		const emailVerificationToken = randomBytes(32).toString('hex')

		await this.prisma.user.update({
			where: { id: userId },
			data: { emailVerificationToken },
		})

		// Отправляем email
		try {
			await this.notificationsService.sendEmailVerification(
				user.email,
				emailVerificationToken,
			)
			console.log(
				`[AuthService] Verification email resent to: ${user.email.split('@')[0]}***@${user.email.split('@')[1]}`,
			)
		} catch (error) {
			console.error('[AuthService] Failed to resend verification email:', error)
			throw new BadRequestException('Не удалось отправить письмо')
		}

		return { message: 'Письмо с подтверждением отправлено повторно' }
	}
}
