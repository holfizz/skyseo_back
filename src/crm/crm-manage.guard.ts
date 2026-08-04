import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

// Управление структурой (воронки и их этапы) — только роль ADMIN, либо любой участник
// в дев-режиме (NODE_ENV != production). Обычный сотрудник структуру менять не может,
// но пользоваться воронкой (двигать клиентов по этапам) — может. Ставится ПОСЛЕ CrmAuthGuard.
@Injectable()
export class CrmManageGuard implements CanActivate {
	constructor(private config: ConfigService) {}

	canActivate(ctx: ExecutionContext): boolean {
		const req = ctx.switchToHttp().getRequest()
		// Дев-обход убран намеренно: если на сервере NODE_ENV не выставлен явно в 'production',
		// проверка отключалась целиком и ЛЮБОЙ сотрудник получал права админа CRM.
		// Для локальной разработки достаточно войти админским аккаунтом.
		if (req.crmUser?.role === 'ADMIN') return true
		throw new ForbiddenException('Управление воронками — только для админа')
	}
}
