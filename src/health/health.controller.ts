import { Controller, Get } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Controller('health')
export class HealthController {
	constructor(private prisma: PrismaService) {}

	@Get()
	async check() {
		try {
			// Проверяем подключение к БД простым запросом
			await this.prisma.$queryRaw`SELECT 1`

			return {
				status: 'ok',
				timestamp: new Date().toISOString(),
				database: 'connected',
			}
		} catch (error) {
			return {
				status: 'error',
				timestamp: new Date().toISOString(),
				database: 'disconnected',
				error: error.message,
			}
		}
	}
}
