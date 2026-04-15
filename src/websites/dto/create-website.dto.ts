import { IsOptional, IsString, IsUrl } from 'class-validator'

export class CreateWebsiteDto {
	@IsString()
	name: string

	@IsUrl()
	url: string

	@IsOptional()
	@IsString()
	city?: string
}
