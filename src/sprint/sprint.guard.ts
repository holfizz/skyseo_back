import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { hasRole } from '../common/roles'

// Кабинет плана: роль MANAGER или ADMIN (админ видит всё, как в SMM).
@Injectable()
export class SprintGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const user = context.switchToHttp().getRequest().user
		if (!hasRole(user, 'MANAGER')) {
			throw new ForbiddenException('Manager access required')
		}
		return true
	}
}
