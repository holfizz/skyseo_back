import { IsBoolean, IsInt, IsOptional, IsUrl, Max, Min } from 'class-validator'

export class UpdateWebsiteDto {
	@IsOptional()
	@IsUrl()
	url?: string

	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@IsOptional()
	@IsInt()
	@Min(3)
	@Max(500)
	dailyVisitsTarget?: number
}
