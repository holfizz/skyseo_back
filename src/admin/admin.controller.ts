import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AdminGuard } from './admin.guard'
import { AdminService } from './admin.service'

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
	constructor(private adminService: AdminService) {}

	@Get('statistics')
	async getStatistics() {
		return this.adminService.getAdminStatistics()
	}

	@Get('users')
	async getAllUsers() {
		return this.adminService.getAllUsers()
	}

	@Get('users/:id')
	async getUser(@Param('id') id: string) {
		return this.adminService.getUserDetails(id)
	}

	@Put('users/:id/balance')
	async adjustBalance(
		@Param('id') id: string,
		@Body() body: { amount: number; description: string },
	) {
		return this.adminService.adjustUserBalance(
			id,
			body.amount,
			body.description,
		)
	}

	@Put('users/:id/toggle-active')
	async toggleUserActive(@Param('id') id: string) {
		return this.adminService.toggleUserActive(id)
	}

	@Get('tasks')
	async getAllTasks() {
		return this.adminService.getAllTasks()
	}

	@Get('executions')
	async getAllExecutions() {
		return this.adminService.getAllExecutions()
	}

	@Get('payments')
	async getAllPayments() {
		return this.adminService.getAllPayments()
	}

	@Get('active-users')
	async getActiveUsers() {
		return this.adminService.getActiveUsersNow()
	}
}
