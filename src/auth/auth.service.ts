import {
	ConflictException,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { TelegramService } from '../telegram/telegram.service'
import { UsersService } from '../users/users.service'
import { LoginDto, RegisterDto } from './dto'

@Injectable()
export class AuthService {
	constructor(
		private usersService: UsersService,
		private jwtService: JwtService,
		private telegramService: TelegramService,
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

		const user = await this.usersService.create({
			email: dto.email,
			password: hashedPassword,
			referralSource: dto.referralSource,
			city: dto.city || this.getCityFromIp(ipAddress),
			lastLoginIp: ipAddress,
		})

		// Отправка уведомления в Telegram
		await this.telegramService.sendAdminNotification(
			`🆕 Новая регистрация\n\n` +
				`Email: ${user.email}\n` +
				`Город: ${user.city || 'Не указан'}\n` +
				`Источник: ${user.referralSource || 'Не указан'}\n` +
				`Баланс: ${user.balance} баллов (приветственный бонус)`,
		)

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
}
