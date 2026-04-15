import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator'

export class CompleteExecutionDto {
	@IsBoolean()
	foundInTop: boolean

	@IsOptional()
	@IsInt()
	@Min(1)
	position?: number

	@IsInt()
	@Min(0)
	pagesVisited: number

	@IsInt()
	@Min(0)
	duration: number // в секундах
}
