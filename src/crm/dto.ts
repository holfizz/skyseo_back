import { CrmClientStatus, CrmDealStatus, CrmLeadSource, CrmLeadStatus, CrmTaskKind, CrmTaskStatus } from '@prisma/client'
import { Type } from 'class-transformer'
import {
	ArrayMaxSize,
	IsArray,
	IsEnum,
	IsIn,
	IsInt,
	IsISO8601,
	IsOptional,
	IsString,
	IsUUID,
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

// Основной вход в CRM: email + пароль аккаунта платформы.
export class CrmPasswordLoginDto {
	@IsString()
	@MinLength(3)
	@MaxLength(160)
	email: string

	@IsString()
	@MinLength(1)
	@MaxLength(200)
	password: string
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
	@IsOptional() @IsUUID()
	requestId?: string

	@IsString()
	@MinLength(1)
	@MaxLength(200)
	title: string

	@IsOptional() @IsEnum(CrmTaskKind) kind?: CrmTaskKind

	@IsOptional() @IsString() @MaxLength(4000) description?: string
	@IsOptional() @IsEnum(CrmTaskStatus) status?: CrmTaskStatus

	@IsOptional() @IsInt() @Min(-1) @Max(2) priority?: number // -1 низкий … 2 срочный

	@IsOptional() @IsISO8601() dueAt?: string
	@IsOptional() @IsString() clientId?: string
	@IsOptional() @IsString() leadId?: string
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

// ─── Лиды ───
export class CreateLeadDto {
	@IsString() @MinLength(1) @MaxLength(160)
	title: string

	@IsOptional() @IsString() @MaxLength(200)
	contact?: string

	@IsOptional() @IsEnum(CrmLeadSource)
	source?: CrmLeadSource

	@IsOptional() @IsString() @MaxLength(2000)
	comment?: string

	@IsOptional() @IsString()
	assigneeId?: string
}

export class QualificationNotesDto {
	// Заметки сценария созвона хранятся в CRM-лиде вместе с остальной квалификацией.
	@IsOptional() @IsString() @MaxLength(2000) callIntroComment?: string
	@IsOptional() @IsString() @MaxLength(2000) callDiscoveryComment?: string
	@IsOptional() @IsString() @MaxLength(2000) callDataComment?: string
	@IsOptional() @IsString() @MaxLength(2000) callTermsComment?: string
	@IsOptional() @IsString() @MaxLength(2000) callTestComment?: string
	@IsOptional() @IsString() @MaxLength(500) callQueryRelevance?: string
	@IsOptional() @IsString() @MaxLength(1000) callCompetitorFinding?: string
	@IsOptional() @IsString() @MaxLength(300) callStartAnswer?: string
	@IsOptional() @IsString() @MaxLength(500) callTestDirection?: string
	@IsOptional() @IsString() @MaxLength(1000) callTestHypothesis?: string
	@IsOptional() @IsString() @MaxLength(500) callTestDecision?: string
	@IsOptional() @IsString() @MaxLength(300) callTestNextContact?: string
	@IsOptional() @IsString() @MaxLength(1000) need?: string
	@IsOptional() @IsString() @MaxLength(1000) desiredResult?: string
	@IsOptional() @IsString() @MaxLength(1000) priorityCategories?: string
	@IsOptional() @IsString() @MaxLength(1000) currentSources?: string
	@IsOptional() @IsString() @MaxLength(1000) currentSeo?: string
	@IsOptional() @IsString() @MaxLength(1000) seoIssues?: string
	@IsOptional() @IsString() @MaxLength(300) currentLeads?: string
	@IsOptional() @IsString() @MaxLength(300) targetLeads?: string
	@IsOptional() @IsString() @MaxLength(1000) vendorCriteria?: string
	@IsOptional() @IsString() @MaxLength(1000) objection?: string
	@IsOptional() @IsString() @MaxLength(1000) nextStep?: string
	@IsOptional() @IsString() @MaxLength(1000) seoGoal?: string

	@IsOptional() @IsIn(['YES', 'NO']) hasSeo?: string
	@IsOptional() @IsIn(['IN_HOUSE', 'AGENCY', 'FREELANCER', 'UNKNOWN']) seoProvider?: string
	@IsOptional() @IsIn(['YES', 'NO', 'PARTIAL']) seoSatisfied?: string
	@IsOptional() @IsIn(['YES', 'NO']) hasAds?: string
	@IsOptional() @IsIn(['YES', 'NO', 'UNKNOWN']) websiteLeads?: string
	@IsOptional() @IsIn(['YES', 'NO']) tracksOrganicLeads?: string
	@IsOptional() @IsIn(['YES', 'NO', 'UNKNOWN']) hasCrm?: string
	@IsOptional() @IsIn(['YES', 'NO', 'PARTIAL', 'UNKNOWN']) isDecisionMaker?: string
	@IsOptional() @IsIn(['YES', 'NO']) budgetDiscussed?: string
	@IsOptional() @IsIn(['YES', 'NO', 'UNCLEAR']) needsSeo?: string
	@IsOptional() @IsIn(['YES', 'NO', 'UNCLEAR']) openToContractor?: string
	@IsOptional() @IsIn(['YES', 'NO']) hasContractor?: string
	@IsOptional() @IsIn(['YES', 'NO', 'PARTIAL']) dissatisfied?: string
	@IsOptional() @IsIn(['NOW', 'MONTH', 'LATER', 'UNKNOWN']) startTiming?: string
	@IsOptional() @IsIn(['NOT_OFFERED', 'INTERESTED', 'NOT_INTERESTED', 'ONLY_IF_UNSURE']) testInterest?: string
	@IsOptional() @IsIn(['PRICE', 'TRUST', 'RESULT', 'CONTRACTOR', 'NO_BUDGET', 'NOT_NOW', 'NO_NEED', 'NEEDS_APPROVAL', 'OTHER']) objectionCode?: string
	@IsOptional() @IsIn(['CALL_BOOK', 'CALL_HOLD', 'SEO_REVIEW', 'PREPARE_PROPOSAL', 'SEND_PROPOSAL', 'TEST', 'FOLLOW_UP', 'CONTRACT', 'LOST']) nextStepCode?: string
	@IsOptional() @IsArray() @ArrayMaxSize(9) @IsIn(['PRICE', 'EXPERIENCE', 'CASES', 'FORECAST', 'TRANSPARENCY', 'SPEED', 'TURNKEY', 'NICHE', 'OTHER'], { each: true }) vendorCriteriaCodes?: string[]
	@IsOptional() @IsArray() @ArrayMaxSize(7) @IsIn(['DIRECT', 'ORGANIC', 'REFERRALS', 'TELEGRAM', 'SOCIAL', 'AVITO', 'OTHER'], { each: true }) leadSources?: string[]
}

export class UpdateLeadDto {
	@IsOptional() @IsString() @MinLength(1) @MaxLength(160)
	title?: string

	@IsOptional() @IsString() @MaxLength(200)
	contact?: string

	@IsOptional() @IsEnum(CrmLeadStatus)
	status?: CrmLeadStatus

	@IsOptional() @IsString() @MaxLength(2000)
	comment?: string

	@IsOptional() @IsString() @MaxLength(300)
	rejectReason?: string

	@IsOptional() @IsString()
	assigneeId?: string

	@IsOptional() @IsInt() @Min(0)
	budgetMin?: number | null

	@IsOptional() @IsInt() @Min(0)
	budgetMax?: number | null

	@IsOptional() @IsString() @MaxLength(500)
	budgetComment?: string | null

	@IsOptional() @IsString() @MaxLength(160)
	decisionMaker?: string | null

	@IsOptional() @ValidateNested() @Type(() => QualificationNotesDto)
	qualification?: QualificationNotesDto
}

export class MoveLeadStageDto {
	@IsOptional() @IsString()
	stageId?: string | null
}

export class SaveFollowUpDto {
	@IsOptional() @IsString()
	taskId?: string

	@IsOptional() @IsString()
	recipientId?: string | null

	@IsOptional() @IsISO8601()
	dueAt?: string | null

	@IsOptional() @IsString() @MaxLength(300)
	note?: string | null
}

// Квалификация: лид становится клиентом и, если указана сумма, сразу сделкой.
export class QualifyLeadDto {
	@IsOptional() @IsInt() @Min(0)
	amount?: number

	@IsOptional() @IsString()
	stageId?: string

	@IsOptional() @IsString()
	tariffId?: string
}

// ─── Сделки ───
export class CreateDealDto {
	@IsString()
	clientId: string

	@IsOptional() @IsString() leadId?: string

	@IsString() @MinLength(1) @MaxLength(160)
	title: string

	@IsOptional() @IsInt() @Min(0)
	amount?: number

	@IsOptional() @IsString()
	tariffId?: string

	@IsOptional() @IsString()
	stageId?: string

	@IsOptional() @IsInt() @Min(0) @Max(100)
	probability?: number

	@IsOptional() @IsISO8601()
	expectedCloseAt?: string

	@IsOptional() @IsString()
	assigneeId?: string
}

export class UpdateDealDto {
	@IsOptional() @IsString() @MinLength(1) @MaxLength(160)
	title?: string

	@IsOptional() @IsInt() @Min(0)
	amount?: number

	@IsOptional() @IsString()
	tariffId?: string

	@IsOptional() @IsEnum(CrmDealStatus)
	status?: CrmDealStatus

	@IsOptional() @IsString() @MaxLength(300)
	lostReason?: string

	@IsOptional() @IsString() @MaxLength(1000)
	lostComment?: string

	@IsOptional() @IsInt() @Min(0) @Max(100)
	probability?: number

	@IsOptional() @IsISO8601()
	expectedCloseAt?: string

	@IsOptional() @IsString()
	assigneeId?: string
}

export class MoveDealDto {
	@IsString()
	stageId: string

	@IsOptional() @IsInt() @Min(0)
	position?: number
}

// ─── Тарифы ───
export class TariffDto {
	@IsOptional() @IsString() @MinLength(1) @MaxLength(80)
	name?: string

	@IsOptional() @IsString() @MaxLength(400)
	description?: string

	@IsOptional() @IsInt() @Min(0)
	points?: number

	@IsOptional() @IsInt() @Min(0)
	price?: number

	@IsOptional()
	isActive?: boolean
}
