import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator'

export class CompleteExecutionDto {
	@IsBoolean()
	foundInTop: boolean

	@IsOptional()
	@IsInt()
	@Min(1)
	position?: number

	@IsOptional()
	@IsInt()
	@Min(1)
	yandexPosition?: number

	@IsOptional()
	@IsInt()
	@Min(1)
	googlePosition?: number

	@IsInt()
	@Min(0)
	pagesVisited: number

	@IsInt()
	@Min(0)
	duration: number // в секундах
}
