import { CrmCustomFieldType } from '@prisma/client'
import { Allow, ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'

export class CreateCustomFieldDto {
	@IsString() @Matches(/^[a-z][a-z0-9_]{2,49}$/)
	key: string

	@IsString() @MinLength(2) @MaxLength(100)
	name: string

	@IsEnum(CrmCustomFieldType)
	type: CrmCustomFieldType

	@IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
	options?: string[]

	@IsOptional() @IsInt() @Min(0) @Max(1000)
	position?: number

	@IsOptional() @IsBoolean()
	required?: boolean
}

export class UpdateCustomFieldDto {
	@IsOptional() @IsString() @MinLength(2) @MaxLength(100)
	name?: string

	@IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
	options?: string[]

	@IsOptional() @IsInt() @Min(0) @Max(1000)
	position?: number

	@IsOptional() @IsBoolean()
	isActive?: boolean

	@IsOptional() @IsBoolean()
	required?: boolean
}

export class SaveCustomValueDto {
	@Allow()
	value: unknown
}
