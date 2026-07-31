import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'

// Пускает только роль ADMIN. Ставится ПОСЛЕ CrmAuthGuard (использует request.crmUser).
@Injectable()
export class CrmAdminGuard implements CanActivate {
	canActivate(ctx: ExecutionContext): boolean {
		const req = ctx.switchToHttp().getRequest()
		if (req.crmUser?.role !== 'ADMIN') {
			throw new ForbiddenException('Только для админа CRM')
		}
		return true
	}
}
