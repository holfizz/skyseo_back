import { CrmClientStatus, CrmTaskStatus } from '@prisma/client'
import { Type } from 'class-transformer'
import {
	ArrayMaxSize,
	IsArray,
	IsEnum,
	IsInt,
	IsISO8601,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateNested,
} from 'class-validator'

// Вход через Telegram Mini App
export class CrmLoginDto {
	@IsString()
	@MinLength(1)
	@MaxLength(8000)
	initData: string
}

// Одно напоминание: либо смещение в минутах от дедлайна, либо абсолютное время.
export class ReminderInputDto {
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(60 * 24 * 60) // до 60 суток
	offsetMinutes?: number

	@IsOptional()
	@IsISO8601()
	remindAt?: string

	@IsOptional()
	@IsString()
	@MaxLength(40)
	label?: string

	@IsOptional()
	@IsString()
	targetId?: string
}

export class CreateClientDto {
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	title: string

	@IsOptional() @IsString() @MaxLength(120) company?: string
	@IsOptional() @IsString() @MaxLength(60) phone?: string
	@IsOptional() @IsString() @MaxLength(160) email?: string
	@IsOptional() @IsString() @MaxLength(120) telegram?: string
	@IsOptional() @IsString() @MaxLength(200) website?: string
	@IsOptional() @IsEnum(CrmClientStatus) status?: CrmClientStatus
	@IsOptional() @IsString() @MaxLength(4000) notes?: string
	@IsOptional() @IsString() userId?: string // связь с аккаунтом платформы
	@IsOptional() @IsString() assigneeId?: string
}

export class UpdateClientDto {
	@IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string
	@IsOptional() @IsString() @MaxLength(120) company?: string
	@IsOptional() @IsString() @MaxLength(60) phone?: string
	@IsOptional() @IsString() @MaxLength(160) email?: string
	@IsOptional() @IsString() @MaxLength(120) telegram?: string
	@IsOptional() @IsString() @MaxLength(200) website?: string
	@IsOptional() @IsEnum(CrmClientStatus) status?: CrmClientStatus
	@IsOptional() @IsString() @MaxLength(4000) notes?: string
	// userId допускает null для отвязки аккаунта
	@IsOptional() @IsString() userId?: string | null
	@IsOptional() @IsString() assigneeId?: string | null
}

export class CreateTaskDto {
	@IsString()
	@MinLength(1)
	@MaxLength(200)
	title: string

	@IsOptional() @IsString() @MaxLength(4000) description?: string
	@IsOptional() @IsEnum(CrmTaskStatus) status?: CrmTaskStatus

	@IsOptional() @IsInt() @Min(-1) @Max(2) priority?: number // -1 низкий … 2 срочный

	@IsOptional() @IsISO8601() dueAt?: string
	@IsOptional() @IsString() clientId?: string
	@IsOptional() @IsString() assigneeId?: string

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(20)
	@ValidateNested({ each: true })
	@Type(() => ReminderInputDto)
	reminders?: ReminderInputDto[]
}

export class UpdateTaskDto {
	@IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string
	@IsOptional() @IsString() @MaxLength(4000) description?: string
	@IsOptional() @IsEnum(CrmTaskStatus) status?: CrmTaskStatus
	@IsOptional() @IsInt() @Min(-1) @Max(2) priority?: number
	@IsOptional() @IsISO8601() dueAt?: string | null
	@IsOptional() @IsString() clientId?: string | null
	@IsOptional() @IsString() assigneeId?: string | null
}

export class MoveTaskDto {
	@IsEnum(CrmTaskStatus) status: CrmTaskStatus
	@IsInt() @Min(0) position: number
}

// ─── воронки (пайплайны) ───
export class StageInputDto {
	@IsString() @MinLength(1) @MaxLength(60) title: string
	@IsOptional() @IsString() @MaxLength(9) color?: string
}

export class CreateFunnelDto {
	@IsString() @MinLength(1) @MaxLength(60) name: string
	@IsOptional() @IsString() @MaxLength(9) color?: string

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(40)
	@ValidateNested({ each: true })
	@Type(() => StageInputDto)
	stages?: StageInputDto[]
}

export class UpdateFunnelDto {
	@IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string
	@IsOptional() @IsString() @MaxLength(9) color?: string
}

export class CreateStageDto {
	@IsString() @MinLength(1) @MaxLength(60) title: string
	@IsOptional() @IsString() @MaxLength(9) color?: string
}

export class UpdateStageDto {
	@IsOptional() @IsString() @MinLength(1) @MaxLength(60) title?: string
	@IsOptional() @IsString() @MaxLength(9) color?: string
}

export class MoveStageDto {
	@IsInt() @Min(0) position: number
}

export class MoveClientStageDto {
	@IsOptional() @IsString() stageId?: string // пусто → убрать из воронки
}
