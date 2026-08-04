import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'
import { hasRole } from '../common/roles'

// Доступ к SMM-дашборду: роль SMM или ADMIN (админ видит всё).
@Injectable()
export class SmmGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const user = context.switchToHttp().getRequest().user
		if (!hasRole(user, 'SMM')) {
			throw new ForbiddenException('SMM access required')
		}
		return true
	}
}
