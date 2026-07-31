import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { CrmUser } from '@prisma/client'

// Текущий участник CRM (кладётся в request.crmUser гвардом CrmAuthGuard).
export const CrmCurrentUser = createParamDecorator(
	(_data: unknown, ctx: ExecutionContext): CrmUser => {
		return ctx.switchToHttp().getRequest().crmUser
	},
)
