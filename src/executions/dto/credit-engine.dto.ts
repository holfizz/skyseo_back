import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator'

export enum EngineDto {
	YANDEX = 'yandex',
	GOOGLE = 'google',
}

export class CreditEngineDto {
	@IsEnum(EngineDto)
	engine: EngineDto

	@IsBoolean()
	foundInTop: boolean

	@IsOptional()
	@IsInt()
	@Min(1)
	position?: number

	@IsInt()
	@Min(0)
	pagesVisited: number
}
