import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common'
import { AuthService } from './auth.service'
import {
	ForgotPasswordDto,
	LoginDto,
	RegisterDto,
	ResetPasswordDto,
} from './dto'
import { JwtAuthGuard } from './jwt-auth.guard'

@Controller('auth')
export class AuthController {
	constructor(private authService: AuthService) {}

	@Post('register')
	async register(@Body() dto: RegisterDto, @Request() req: any) {
		// Получаем реальный IP из заголовков Nginx (приоритет по порядку)
		const ip =
			req.headers['x-real-ip'] ||
			req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
			req.connection?.remoteAddress ||
			req.socket?.remoteAddress ||
			req.ip ||
			'unknown'

		console.log('[AuthController] Registration IP headers:', {
			'x-real-ip': req.headers['x-real-ip'],
			'x-forwarded-for': req.headers['x-forwarded-for'],
			'connection.remoteAddress': req.connection?.remoteAddress,
			'req.ip': req.ip,
			final_ip: ip,
		})

		return this.authService.register(dto, ip)
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
