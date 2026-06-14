import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator'

export class UpdateWebsiteDto {
	// url/name намеренно НЕ редактируются — сменить сам сайт нельзя, только просмотры/режим.
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(500)
	dailyVisitsTarget?: number

	@IsOptional()
	@IsBoolean()
	autoMaxVisits?: boolean
}
