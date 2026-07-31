import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common'
import { CrmAuthService } from './crm-auth.service'

// Проверяет Bearer-токен CRM и кладёт участника в request.crmUser.
@Injectable()
export class CrmAuthGuard implements CanActivate {
	constructor(private auth: CrmAuthService) {}

	async canActivate(ctx: ExecutionContext): Promise<boolean> {
		const req = ctx.switchToHttp().getRequest()
		const header: string = req.headers['authorization'] || ''
		const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
		if (!token) throw new UnauthorizedException('Нет токена')
		req.crmUser = await this.auth.verifyToken(token)
		return true
	}
}
