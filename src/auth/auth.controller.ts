import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common'
import { AuthService } from './auth.service'
import {
	ForgotPasswordDto,
	LoginDto,
	RegisterDto,
	ResetPasswordDto,
} from './dto'
import { JwtAuthGuard } from './jwt-auth.guard'
import { lookupPromoCode } from './promo-codes'
import { PrismaService } from '../prisma/prisma.service'

@Controller('auth')
export class AuthController {
	constructor(
		private authService: AuthService,
		private prisma: PrismaService,
	) {}

	// Единое поле: код может быть промокодом (бонус новичку) ИЛИ кодом друга (реферал)
	@Get('check-promo')
	async checkPromo(@Query('code') code: string) {
		const promo = await lookupPromoCode(this.prisma, code)
		if (promo) {
			return { valid: true, kind: 'promo', bonusPoints: promo.bonusPoints, description: promo.description }
		}
		const normalized = code?.trim().toUpperCase()
		if (normalized) {
			const referrer = await this.prisma.user.findUnique({
				where: { referralCode: normalized },
				select: { id: true },
			})
			if (referrer) return { valid: true, kind: 'referral' }
		}
		return { valid: false }
	}

	// Реф-код по IP: при переходе по реф-ссылке мы записали PageEvent(ref, ip).
	// Приложение спрашивает на экране регистрации, чтобы подставить код в поле.
	@Get('detect-referral')
	async detectReferral(@Request() req: any) {
		const ip =
			req.headers['x-real-ip'] ||
			req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
			req.ip
		if (!ip) return { code: null }
		const recentClick = await this.prisma.pageEvent.findFirst({
			where: {
				ref: { not: null },
				ip,
				createdAt: { gte: new Date(Date.now() - 72 * 60 * 60 * 1000) },
			},
			orderBy: { createdAt: 'desc' },
			select: { ref: true },
		})
		const code = recentClick?.ref?.trim().toUpperCase()
		if (code) {
			// отдаём только если это реально существующий реф-код
			const exists = await this.prisma.user.findUnique({
				where: { referralCode: code },
				select: { id: true },
			})
			if (exists) return { code }
		}
		return { code: null }
	}

	@Post('register')
	async register(@Body() dto: RegisterDto, @Request() req: any) {
		// Получаем реальный IP из заголовков Nginx (приоритет по порядку)
		const xRealIp = req.headers['x-real-ip']
		const xForwardedFor = req.headers['x-forwarded-for']
		const connectionRemote = req.connection?.remoteAddress
		const socketRemote = req.socket?.remoteAddress
		const reqIp = req.ip

		// Парсим X-Forwarded-For (берем первый IP, который не является приватным)
		let finalIp = 'unknown'

		if (xRealIp) {
			finalIp = xRealIp
		} else if (xForwardedFor) {
			const ips = xForwardedFor.split(',').map(ip => ip.trim())
			// Ищем первый публичный IP
			for (const ip of ips) {
				if (
					!ip.startsWith('172.') &&
					!ip.startsWith('10.') &&
					!ip.startsWith('192.168.') &&
					ip !== '127.0.0.1'
				) {
					finalIp = ip
					break
				}
			}
			// Если публичный не найден, берем первый
			if (finalIp === 'unknown' && ips.length > 0) {
				finalIp = ips[0]
			}
		} else if (
			reqIp &&
			!reqIp.startsWith('172.') &&
			!reqIp.startsWith('10.') &&
			!reqIp.startsWith('192.168.')
		) {
			finalIp = reqIp
		} else if (connectionRemote) {
			finalIp = connectionRemote
		} else if (socketRemote) {
			finalIp = socketRemote
		}

		console.log('[AuthController] Registration IP analysis:', {
			'x-real-ip': xRealIp,
			'x-forwarded-for': xForwardedFor,
			'connection.remoteAddress': connectionRemote,
			'socket.remoteAddress': socketRemote,
			'req.ip': reqIp,
			final_ip: finalIp,
			all_headers: Object.keys(req.headers)
				.filter(
					h =>
						h.includes('forward') || h.includes('real') || h.includes('client'),
				)
				.reduce((acc, key) => {
					acc[key] = req.headers[key]
					return acc
				}, {}),
		})

		return this.authService.register(dto, finalIp)
	}

	@Post('login')
	async login(@Body() dto: LoginDto) {
		return this.authService.login(dto)
	}

	@Post('forgot-password')
	async forgotPassword(@Body() dto: ForgotPasswordDto) {
		return this.authService.forgotPassword(dto.email)
	}

	@Post('reset-password')
	async resetPassword(@Body() dto: ResetPasswordDto) {
		return this.authService.resetPassword(dto.token, dto.password)
	}

	@Post('verify-email')
	async verifyEmail(@Body() body: { token: string }) {
		return this.authService.verifyEmail(body.token)
	}

	@Post('resend-verification')
	@UseGuards(JwtAuthGuard)
	async resendVerification(@Request() req) {
		return this.authService.resendVerificationEmail(req.user.id)
	}
}
