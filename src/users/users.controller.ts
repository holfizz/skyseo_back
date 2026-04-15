import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UsersService } from './users.service'

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
	constructor(private usersService: UsersService) {}

	@Get('profile')
	async getProfile(@Request() req) {
		return this.usersService.getProfile(req.user.id)
	}

	@Get('balance-history')
	async getBalanceHistory(@Request() req) {
		return this.usersService.getBalanceHistory(req.user.id)
	}
}
