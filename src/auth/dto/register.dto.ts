import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator'

export class RegisterDto {
	@IsEmail()
	email: string

	@IsString()
	@MinLength(6)
	password: string

	@IsOptional()
	@IsString()
	referralSource?: string

	@IsOptional()
	@IsString()
	referralCode?: string

	@IsOptional()
	@IsString()
	promoCode?: string

	@IsOptional()
	@IsString()
	city?: string

	@IsOptional()
	@IsString()
	appVersion?: string

	@IsOptional()
	@IsString()
	role?: string // frontend userType selection: marketer | seo | entrepreneur | startup
}
