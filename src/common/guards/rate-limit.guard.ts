import {
	CanActivate,
	ExecutionContext,
	HttpException,
	HttpStatus,
	Injectable,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class RateLimitGuard implements CanActivate {
	private requestCounts = new Map<
		string,
		{ count: number; resetTime: number }
	>()

	constructor(private prisma: PrismaService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest()
		const userId = request.user?.id
		const ip = request.ip
		const key = userId || ip

		const now = Date.now()
		const limit = 100 // запросов
		const window = 60 * 1000 // за 1 минуту

		const record = this.requestCounts.get(key)

		if (!record || now > record.resetTime) {
			this.requestCounts.set(key, { count: 1, resetTime: now + window })
			return true
		}

		if (record.count >= limit) {
			throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS)
		}

		record.count++
		return true
	}
}
