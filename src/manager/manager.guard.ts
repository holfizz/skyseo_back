import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'

// Доступ к кабинету менеджера: роль MANAGER или ADMIN (админ видит всё).
@Injectable()
export class ManagerGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const user = context.switchToHttp().getRequest().user
		if (!user || (user.role !== 'MANAGER' && user.role !== 'ADMIN')) {
			throw new ForbiddenException('Manager access required')
		}
		return true
	}
}
