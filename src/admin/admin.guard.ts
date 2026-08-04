import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'
import { hasRole } from '../common/roles'

@Injectable()
export class AdminGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest()
		const user = request.user

		if (!hasRole(user, 'ADMIN')) {
			throw new ForbiddenException('Admin access required')
		}

		return true
	}
}
