import { Body, Controller, Ip, Post } from '@nestjs/common'
import { AuthService } from './auth.service'
import { LoginDto, RegisterDto } from './dto'

@Controller('auth')
export class AuthController {
	constructor(private authService: AuthService) {}

	@Post('register')
	async register(@Body() dto: RegisterDto, @Ip() ip: string) {
		return this.authService.register(dto, ip)
	}

	@Post('login')
	async login(@Body() dto: LoginDto) {
		return this.authService.login(dto)
	}
}
