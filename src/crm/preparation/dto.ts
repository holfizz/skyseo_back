import { IsOptional, IsString, MaxLength, IsInt, Min, Max, IsIn, IsBoolean } from 'class-validator'
export class PrepareCallDto {
 @IsOptional() @IsString() @MaxLength(250) website?:string
 @IsOptional() @IsString() @MaxLength(120) region?:string
 @IsOptional() @IsInt() @Min(8) @Max(100) maxKeywords?:number
 @IsOptional() @IsIn(['CONFIRMED','UNCONFIRMED','UNAVAILABLE']) trial?:'CONFIRMED'|'UNCONFIRMED'|'UNAVAILABLE'
 @IsOptional() @IsBoolean() refresh?:boolean
 @IsOptional() @IsIn(['SITE','KEYWORDS','POSITIONS','COMPETITORS','DOCUMENTS']) retryPhase?:string
}
