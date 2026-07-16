import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'

// Доступ к SMM-дашборду: роль SMM или ADMIN (админ видит всё).
@Injectable()
export class SmmGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const user = context.switchToHttp().getRequest().user
		if (!user || (user.role !== 'SMM' && user.role !== 'ADMIN')) {
			throw new ForbiddenException('SMM access required')
		}
		return true
	}
}
