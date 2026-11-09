-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'SMM', 'MANAGER');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('MARKETER', 'SEO', 'ENTREPRENEUR', 'STARTUP');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('SEARCH_KEYWORD', 'EXTERNAL_LINK', 'SEARCH_AND_VISIT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExecutionCompletionKind" AS ENUM ('NORMAL', 'DEGRADED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BalanceHistoryType" AS ENUM ('WELCOME_BONUS', 'TASK_EARNED', 'TASK_SPENT', 'PAYMENT', 'REFUND', 'ADMIN_ADJUSTMENT', 'REFERRAL_BONUS', 'DAILY_REWARD', 'WINBACK_BONUS');

-- CreateEnum
CREATE TYPE "FailureReason" AS ENUM ('CAPTCHA', 'SCRIPT_ERROR', 'NOT_IN_SERP', 'LOCK_TIMEOUT');

-- CreateEnum
CREATE TYPE "KeywordRestrictionStatus" AS ENUM ('ACTIVE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "AppStatus" AS ENUM ('NEVER', 'ACTIVE', 'UNINSTALLED', 'REINSTALLED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('DARWIN_ARM64', 'DARWIN_X64', 'WIN32_X64', 'WIN32_IA32');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('NEW', 'CONTACTED', 'INTERESTED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "CrmRole" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "CrmClientStatus" AS ENUM ('LEAD', 'NEGOTIATION', 'ACTIVE', 'PAUSED', 'CHURNED');

-- CreateEnum
CREATE TYPE "CrmTaskStatus" AS ENUM ('DRAFT', 'TODO', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "CrmTaskKind" AS ENUM ('GENERAL', 'CALL', 'FOLLOW_UP', 'SEO_EVALUATION', 'PROPOSAL');

-- CreateEnum
CREATE TYPE "CrmCustomFieldType" AS ENUM ('BOOLEAN', 'TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'DATE');

-- CreateEnum
CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'IN_WORK', 'QUALIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CrmLeadSource" AS ENUM ('SITE_FORM', 'TELEGRAM', 'OUTREACH', 'REFERRAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "CrmDealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "TrialOutreachStatus" AS ENUM ('QUEUED', 'SENT_TO_MANAGER', 'MESSAGE_SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "TgAccountStatus" AS ENUM ('NEW', 'READY', 'WARMING', 'PAUSED', 'BANNED', 'ERROR');

-- CreateEnum
CREATE TYPE "TgWarmupStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'DONE', 'FAILED', 'STOPPED');

-- CreateEnum
CREATE TYPE "TgAccountGender" AS ENUM ('UNSPECIFIED', 'MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "TgCampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'DONE');

-- CreateEnum
CREATE TYPE "TgRecipientStatus" AS ENUM ('QUEUED', 'SENT', 'READ', 'REPLIED', 'SECOND_SENT', 'BLOCKED', 'FAILED', 'STOPPED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 1000,
    "paidUntil" TIMESTAMP(3),
    "trialStartedAt" TIMESTAMP(3),
    "trialEndEmailSentAt" TIMESTAMP(3),
    "role" "Role" NOT NULL DEFAULT 'USER',
    "roles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "userType" "UserType",
    "referralSource" TEXT,
    "referralCode" TEXT,
    "referredBy" TEXT,
    "marketingCode" TEXT,
    "promoCode" TEXT,
    "city" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSuspicious" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationToken" TEXT,
    "lastLoginIp" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "registrationIp" TEXT,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastFailedLogin" TIMESTAMP(3),
    "appVersion" TEXT,
    "appStatus" "AppStatus" NOT NULL DEFAULT 'NEVER',
    "appLastLoginAt" TIMESTAMP(3),
    "uninstallToken" TEXT,
    "winbackEmailSentAt" TIMESTAMP(3),
    "winbackBonusGrantedAt" TIMESTAMP(3),
    "weeklyReportEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiAnalysesCount" INTEGER NOT NULL DEFAULT 0,
    "priorityBoost" INTEGER NOT NULL DEFAULT 1,
    "telegramChatId" TEXT,
    "telegramUsername" TEXT,
    "telegramLinkCode" TEXT,
    "telegramLinkCodeExpiresAt" TIMESTAMP(3),
    "telegramLinkedAt" TIMESTAMP(3),
    "telegramContact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "websites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "city" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "dailyVisitsTarget" INTEGER,
    "autoMaxVisits" BOOLEAN NOT NULL DEFAULT false,
    "adPolicy" TEXT NOT NULL DEFAULT 'EXCLUDE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "websites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "type" "TaskType" NOT NULL,
    "keyword" TEXT,
    "targetUrl" TEXT,
    "externalUrl" TEXT,
    "geo" TEXT NOT NULL DEFAULT 'Москва',
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "pointsCost" INTEGER NOT NULL DEFAULT 10,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxYandexVisits" INTEGER NOT NULL DEFAULT 3,
    "maxGoogleVisits" INTEGER NOT NULL DEFAULT 3,
    "useYandex" BOOLEAN NOT NULL DEFAULT true,
    "useGoogle" BOOLEAN NOT NULL DEFAULT true,
    "pagesDepthFrom" INTEGER NOT NULL DEFAULT 3,
    "pagesDepthTo" INTEGER NOT NULL DEFAULT 5,
    "pageDurationFrom" INTEGER NOT NULL DEFAULT 60,
    "pageDurationTo" INTEGER NOT NULL DEFAULT 180,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "keywordStatus" "KeywordRestrictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "notifiedBestPosition" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignedAt" TIMESTAMP(3),
    "assignedExecutorId" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pinned_tasks" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 1,
    "force" BOOLEAN NOT NULL DEFAULT false,
    "targetExecutorId" TEXT,
    "targetUntilAt" TIMESTAMP(3),
    "consumedByExecutorId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pinned_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "websiteId" TEXT,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "pointsSpent" INTEGER NOT NULL DEFAULT 0,
    "foundInTop" BOOLEAN,
    "position" INTEGER,
    "yandexFoundInTop" BOOLEAN,
    "googleFoundInTop" BOOLEAN,
    "yandexPosition" INTEGER,
    "googlePosition" INTEGER,
    "yandexCreditedAt" TIMESTAMP(3),
    "googleCreditedAt" TIMESTAMP(3),
    "failureReason" "FailureReason",
    "targetVisited" BOOLEAN NOT NULL DEFAULT false,
    "directNavigationUsed" BOOLEAN NOT NULL DEFAULT false,
    "completionKind" "ExecutionCompletionKind",
    "pagesVisited" INTEGER NOT NULL DEFAULT 0,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "weekStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_events" (
    "id" TEXT NOT NULL,
    "executionId" TEXT,
    "taskId" TEXT,
    "executorId" TEXT,
    "engine" TEXT,
    "type" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captcha_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "captcha_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statistics" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "position" INTEGER,
    "inTop1" INTEGER NOT NULL DEFAULT 0,
    "inTop2_3" INTEGER NOT NULL DEFAULT 0,
    "inTop5" INTEGER NOT NULL DEFAULT 0,
    "inTop10" INTEGER NOT NULL DEFAULT 0,
    "inTop50" INTEGER NOT NULL DEFAULT 0,
    "belowTop50" INTEGER NOT NULL DEFAULT 0,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "yandexSearches" INTEGER NOT NULL DEFAULT 0,
    "googleSearches" INTEGER NOT NULL DEFAULT 0,
    "yandexVisits" INTEGER NOT NULL DEFAULT 0,
    "googleVisits" INTEGER NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_history" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "yandexPosition" INTEGER,
    "googlePosition" INTEGER,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_checks" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "taskId" TEXT,
    "keyword" TEXT NOT NULL,
    "position" INTEGER,
    "url" TEXT,
    "volume" INTEGER,
    "lr" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "createdByEmail" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_reports" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Москва',
    "keywords" TEXT[],
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_report_runs" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "cost" DOUBLE PRECISION,
    "depth" INTEGER,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "BalanceHistoryType" NOT NULL,
    "description" TEXT NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_rewards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 50,
    "streak" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "points" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'yookassa',
    "externalId" TEXT,
    "confirmationUrl" TEXT,
    "offerSentAt" TIMESTAMP(3),
    "discountToken" TEXT,
    "issuedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_notes" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "downloadUrl" TEXT NOT NULL,
    "sha512" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "releaseNotes" TEXT[],
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "page" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "referrer" TEXT,
    "platform" TEXT,
    "ip" TEXT,
    "ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bonusPoints" INTEGER NOT NULL DEFAULT 500,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "budgetAmount" DECIMAL(10,2),
    "budgetMode" TEXT NOT NULL DEFAULT 'total',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "yandex_ad_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "geo" TEXT,
    "landingUrl" TEXT,
    "dailyBudget" INTEGER NOT NULL DEFAULT 0,
    "adsHeadlines" TEXT,
    "adsDescriptions" TEXT,
    "avatarOk" BOOLEAN NOT NULL DEFAULT false,
    "keywordsResearchOk" BOOLEAN NOT NULL DEFAULT false,
    "analyticsOk" BOOLEAN NOT NULL DEFAULT false,
    "triadLinkOk" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yandex_ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yandex_ad_keywords" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 0,
    "estimatedCpc" INTEGER NOT NULL DEFAULT 0,
    "competition" TEXT,
    "shouldLaunch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yandex_ad_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_ad_channels" (
    "id" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "name" TEXT,
    "postText" TEXT,
    "promoCode" TEXT,
    "postedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "adReturn" INTEGER,
    "subscribers" INTEGER,
    "reach24" INTEGER,
    "err24" INTEGER,
    "postCost" INTEGER,
    "isAuthor" BOOLEAN NOT NULL DEFAULT false,
    "shouldBuy" BOOLEAN NOT NULL DEFAULT false,
    "about" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_ad_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_posts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tgUrl" TEXT,
    "tgText" TEXT,
    "destination" TEXT NOT NULL DEFAULT '/',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_entries" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "registrations" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funnel_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serp_imports" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "rowsCount" INTEGER NOT NULL DEFAULT 0,
    "leadsCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serp_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serp_rows" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,

    CONSTRAINT "serp_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_leads" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "importId" TEXT,
    "inn" TEXT,
    "ogrn" TEXT,
    "ogrnip" TEXT,
    "companyName" TEXT,
    "city" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "middleName" TEXT,
    "keywordsCount" INTEGER NOT NULL DEFAULT 0,
    "bestPosition" INTEGER,
    "score" INTEGER NOT NULL DEFAULT 0,
    "competitors" JSONB,
    "reportToken" TEXT,
    "reportOpenedAt" TIMESTAMP(3),
    "reportOpens" INTEGER NOT NULL DEFAULT 0,
    "contact" TEXT,
    "channel" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "telegram" TEXT,
    "telegramId" TEXT,
    "telegramManual" BOOLEAN NOT NULL DEFAULT false,
    "contactSearchFailed" BOOLEAN NOT NULL DEFAULT false,
    "parkedAt" TIMESTAMP(3),
    "email" TEXT,
    "keywords" TEXT,
    "message" TEXT NOT NULL,
    "status" "OutreachStatus" NOT NULL DEFAULT 'NEW',
    "contactedAt" TIMESTAMP(3),
    "contactedVia" TEXT,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "tgLinkClicked" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_users" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "telegramId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "photoUrl" TEXT,
    "calendarFeedTokenHash" TEXT,
    "role" "CrmRole" NOT NULL DEFAULT 'EMPLOYEE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "crm_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_clients" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "telegram" TEXT,
    "website" TEXT,
    "status" "CrmClientStatus" NOT NULL DEFAULT 'LEAD',
    "notes" TEXT,
    "userId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "funnelId" TEXT,
    "stageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_funnels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_funnels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_funnel_stages" (
    "id" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#a0b5ff',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_funnel_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tasks" (
    "id" TEXT NOT NULL,
    "kind" "CrmTaskKind" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "CrmTaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "clientId" TEXT,
    "leadId" TEXT,
    "followUpRecipientId" TEXT,
    "followUpName" TEXT,
    "followUpContact" TEXT,
    "followUpWebsite" TEXT,
    "followUpSource" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_reminders" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "offsetLabel" TEXT,
    "targetId" TEXT,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activity" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contact" TEXT,
    "source" "CrmLeadSource" NOT NULL DEFAULT 'MANUAL',
    "utm" JSONB,
    "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
    "comment" TEXT,
    "rejectReason" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "clientId" TEXT,
    "outreachLeadId" TEXT,
    "sourceRecipientId" TEXT,
    "funnelId" TEXT,
    "stageId" TEXT,
    "budgetMin" INTEGER,
    "budgetMax" INTEGER,
    "budgetComment" TEXT,
    "decisionMaker" TEXT,
    "qualification" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_call_preparations" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "phase" TEXT NOT NULL DEFAULT 'SITE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "research" JSONB NOT NULL,
    "slideOutline" JSONB,
    "clientPdf" BYTEA,
    "scriptPdf" BYTEA,
    "error" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_call_preparations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_custom_field_definitions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'LEAD',
    "type" "CrmCustomFieldType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_custom_field_values" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "valueBoolean" BOOLEAN,
    "valueText" TEXT,
    "valueNumber" DECIMAL(18,2),
    "valueDate" TIMESTAMP(3),
    "valueOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "leadId" TEXT,
    "title" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "tariffId" TEXT,
    "funnelId" TEXT,
    "stageId" TEXT,
    "probability" INTEGER NOT NULL DEFAULT 50,
    "expectedCloseAt" TIMESTAMP(3),
    "status" "CrmDealStatus" NOT NULL DEFAULT 'OPEN',
    "lostReason" TEXT,
    "lostComment" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_outreach" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telegram" TEXT,
    "websiteUrl" TEXT,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "keywords" INTEGER NOT NULL DEFAULT 0,
    "trialEndsAt" TIMESTAMP(3) NOT NULL,
    "status" "TrialOutreachStatus" NOT NULL DEFAULT 'QUEUED',
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_outreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariffs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "price" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "focus" TEXT NOT NULL,
    "messagesWeek" INTEGER NOT NULL,
    "messagesDay" INTEGER NOT NULL,
    "networkTarget" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_touches" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_touches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_reviews" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sprint_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_proxies" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "secret" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'socks5',
    "type" TEXT,
    "geo" TEXT,
    "note" TEXT,
    "alive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_proxies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_accounts" (
    "restrictedUntil" TIMESTAMP(3),
    "premiumCheckedAt" TIMESTAMP(3),
    "premiumUntil" TIMESTAMP(3),
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outreachStartedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "label" TEXT,
    "phone" TEXT,
    "tgUserId" TEXT,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "gender" "TgAccountGender" NOT NULL DEFAULT 'UNSPECIFIED',
    "session" TEXT NOT NULL,
    "apiId" INTEGER NOT NULL,
    "apiHash" TEXT NOT NULL,
    "deviceModel" TEXT NOT NULL,
    "systemVersion" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "langCode" TEXT NOT NULL,
    "systemLangCode" TEXT NOT NULL,
    "proxyId" TEXT,
    "status" "TgAccountStatus" NOT NULL DEFAULT 'NEW',
    "mode" TEXT NOT NULL DEFAULT 'BOTH',
    "busyUntil" TIMESTAMP(3),
    "busyBy" TEXT,
    "score" DOUBLE PRECISION,
    "warmness" DOUBLE PRECISION,
    "scoredAt" TIMESTAMP(3),
    "probe" JSONB,
    "advice" JSONB,
    "registeredAt" TIMESTAMP(3),
    "avatar" TEXT,
    "actionsTotal" INTEGER NOT NULL DEFAULT 0,
    "warmupDaysDone" INTEGER NOT NULL DEFAULT 0,
    "floodWaits" INTEGER NOT NULL DEFAULT 0,
    "peerFloods" INTEGER NOT NULL DEFAULT 0,
    "reauths" INTEGER NOT NULL DEFAULT 0,
    "lastCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "spamRetryAt" TIMESTAMP(3),
    "dailyCap" INTEGER,
    "dailyCapDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "forceSend" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tg_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_warmup_runs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "dayIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "TgWarmupStatus" NOT NULL DEFAULT 'SCHEDULED',
    "windowFrom" INTEGER NOT NULL DEFAULT 9,
    "windowTo" INTEGER NOT NULL DEFAULT 23,
    "pace" TEXT NOT NULL DEFAULT 'normal',
    "kind" TEXT NOT NULL DEFAULT 'WARMUP',
    "nextRunAt" TIMESTAMP(3),
    "planDate" TEXT,
    "plan" JSONB,
    "doneToday" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "tg_warmup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_warmup_actions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "runId" TEXT,
    "dayIndex" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_warmup_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_campaigns" (
    "hypothesisCursor" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TgCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "firstMessage" TEXT NOT NULL,
    "secondMessage" TEXT,
    "dailyGoal" INTEGER,
    "perAccountPerDay" INTEGER NOT NULL DEFAULT 20,
    "minIntervalSec" INTEGER NOT NULL DEFAULT 240,
    "maxIntervalSec" INTEGER NOT NULL DEFAULT 1200,
    "windowFrom" INTEGER NOT NULL DEFAULT 10,
    "windowTo" INTEGER NOT NULL DEFAULT 20,
    "autoAccounts" BOOLEAN NOT NULL DEFAULT true,
    "sendDate" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),

    CONSTRAINT "tg_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_campaign_accounts" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dailyLimit" INTEGER,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "dayKey" TEXT,
    "nextSendAt" TIMESTAMP(3),
    "pausedUntil" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "tg_campaign_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_recipients" (
    "hypothesisId" TEXT,
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "username" TEXT,
    "phone" TEXT,
    "tgUserId" TEXT,
    "leadId" TEXT,
    "crmLeadId" TEXT,
    "firstName" TEXT,
    "middleName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "domain" TEXT,
    "leadVars" JSONB,
    "outcome" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "followUpAt" TIMESTAMP(3),
    "followUpNote" TEXT,
    "followUpNotifiedAt" TIMESTAMP(3),
    "unreadIn" INTEGER NOT NULL DEFAULT 0,
    "replyHandledThroughTgId" INTEGER NOT NULL DEFAULT 0,
    "replyHandledAt" TIMESTAMP(3),
    "conversationMark" TEXT,
    "conversationMarkedAt" TIMESTAMP(3),
    "status" "TgRecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "accountId" TEXT,
    "deliveryUnknown" BOOLEAN NOT NULL DEFAULT false,
    "scheduledAt" TIMESTAMP(3),
    "plannedAccountId" TEXT,
    "scheduleLocked" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "sentMsgId" INTEGER,
    "readAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "secondSentAt" TIMESTAMP(3),
    "secondMessageDraft" TEXT,
    "blockedAt" TIMESTAMP(3),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastSeenMsgId" INTEGER NOT NULL DEFAULT 0,
    "readOutboxMaxId" INTEGER NOT NULL DEFAULT 0,
    "peerStatus" TEXT,
    "peerSeenAt" TIMESTAMP(3),
    "peerCheckedAt" TIMESTAMP(3),
    "peerDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_reply_reminders" (
    "recipientId" TEXT NOT NULL,
    "anchorTgId" INTEGER NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_reply_reminders_pkey" PRIMARY KEY ("recipientId")
);

-- CreateTable
CREATE TABLE "tg_dialog_messages" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "tgId" INTEGER NOT NULL,
    "out" BOOLEAN NOT NULL,
    "text" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "mediaKind" TEXT,
    "mediaData" TEXT,
    "mediaName" TEXT,
    "mediaSize" INTEGER,
    "replyToTgId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_dialog_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_stop_list" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "label" TEXT,
    "recipientId" TEXT,
    "campaignName" TEXT,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_stop_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_account_events" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_account_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "telegram" TEXT,
    "website" TEXT,
    "monthlyFee" DECIMAL(14,2) NOT NULL,
    "startsOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "cancelledOn" DATE,
    "cancellationReason" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "topvisorLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_months" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "received" DECIMAL(14,2) NOT NULL,
    "expenses" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "note" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_contracts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_settings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "dailyGoal" INTEGER NOT NULL DEFAULT 200,
    "interestedAfter" INTEGER NOT NULL DEFAULT 3,
    "planningPerAccount" INTEGER NOT NULL DEFAULT 20,
    "tgDigestDay" TEXT,

    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_hypothesis_settings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cursor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tg_hypothesis_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_hypotheses" (
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "hasSecondMessage" BOOLEAN NOT NULL DEFAULT false,
    "secondMessage" TEXT,
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_account_history" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent" INTEGER NOT NULL,
    "replies" INTEGER NOT NULL,

    CONSTRAINT "workspace_account_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "users_emailVerificationToken_key" ON "users"("emailVerificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "users_uninstallToken_key" ON "users"("uninstallToken");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramChatId_key" ON "users"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramLinkCode_key" ON "users"("telegramLinkCode");

-- CreateIndex
CREATE INDEX "users_registrationIp_createdAt_idx" ON "users"("registrationIp", "createdAt");

-- CreateIndex
CREATE INDEX "users_marketingCode_idx" ON "users"("marketingCode");

-- CreateIndex
CREATE INDEX "websites_userId_idx" ON "websites"("userId");

-- CreateIndex
CREATE INDEX "tasks_status_priority_idx" ON "tasks"("status", "priority");

-- CreateIndex
CREATE INDEX "tasks_assignedExecutorId_idx" ON "tasks"("assignedExecutorId");

-- CreateIndex
CREATE INDEX "tasks_websiteId_status_isActive_keywordStatus_createdAt_idx" ON "tasks"("websiteId", "status", "isActive", "keywordStatus", "createdAt");

-- CreateIndex
CREATE INDEX "pinned_tasks_consumedAt_position_idx" ON "pinned_tasks"("consumedAt", "position");

-- CreateIndex
CREATE INDEX "executions_executorId_websiteId_weekStart_idx" ON "executions"("executorId", "websiteId", "weekStart");

-- CreateIndex
CREATE INDEX "executions_executorId_status_completedAt_idx" ON "executions"("executorId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "executions_websiteId_status_completedAt_idx" ON "executions"("websiteId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "executions_taskId_executorId_status_idx" ON "executions"("taskId", "executorId", "status");

-- CreateIndex
CREATE INDEX "executions_websiteId_foundInTop_completedAt_idx" ON "executions"("websiteId", "foundInTop", "completedAt");

-- CreateIndex
CREATE INDEX "execution_events_executionId_createdAt_idx" ON "execution_events"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "execution_events_taskId_createdAt_idx" ON "execution_events"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "execution_events_executorId_createdAt_idx" ON "execution_events"("executorId", "createdAt");

-- CreateIndex
CREATE INDEX "captcha_events_createdAt_idx" ON "captcha_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "statistics_websiteId_keyword_date_key" ON "statistics"("websiteId", "keyword", "date");

-- CreateIndex
CREATE INDEX "position_history_taskId_date_idx" ON "position_history"("taskId", "date");

-- CreateIndex
CREATE INDEX "keyword_checks_websiteId_checkedAt_idx" ON "keyword_checks"("websiteId", "checkedAt");

-- CreateIndex
CREATE INDEX "keyword_checks_taskId_checkedAt_idx" ON "keyword_checks"("taskId", "checkedAt");

-- CreateIndex
CREATE INDEX "position_reports_createdAt_idx" ON "position_reports"("createdAt");

-- CreateIndex
CREATE INDEX "position_report_runs_reportId_createdAt_idx" ON "position_report_runs"("reportId", "createdAt");

-- CreateIndex
CREATE INDEX "balance_history_userId_createdAt_idx" ON "balance_history"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "balance_history_type_userId_idx" ON "balance_history"("type", "userId");

-- CreateIndex
CREATE INDEX "daily_rewards_userId_date_idx" ON "daily_rewards"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_rewards_userId_date_key" ON "daily_rewards"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "payments_externalId_key" ON "payments"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_discountToken_key" ON "payments"("discountToken");

-- CreateIndex
CREATE INDEX "payments_userId_idx" ON "payments"("userId");

-- CreateIndex
CREATE INDEX "client_notes_clientId_createdAt_idx" ON "client_notes"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "app_versions_version_platform_key" ON "app_versions"("version", "platform");

-- CreateIndex
CREATE INDEX "page_events_type_createdAt_idx" ON "page_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "page_events_utmSource_createdAt_idx" ON "page_events"("utmSource", "createdAt");

-- CreateIndex
CREATE INDEX "page_events_ip_createdAt_idx" ON "page_events"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "yandex_ad_keywords_campaignId_idx" ON "yandex_ad_keywords"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_posts_code_key" ON "marketing_posts"("code");

-- CreateIndex
CREATE INDEX "funnel_entries_channel_idx" ON "funnel_entries"("channel");

-- CreateIndex
CREATE INDEX "funnel_entries_date_idx" ON "funnel_entries"("date");

-- CreateIndex
CREATE INDEX "serp_imports_createdAt_idx" ON "serp_imports"("createdAt");

-- CreateIndex
CREATE INDEX "serp_rows_importId_keyword_position_idx" ON "serp_rows"("importId", "keyword", "position");

-- CreateIndex
CREATE INDEX "serp_rows_domain_idx" ON "serp_rows"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_leads_reportToken_key" ON "outreach_leads"("reportToken");

-- CreateIndex
CREATE INDEX "outreach_leads_status_idx" ON "outreach_leads"("status");

-- CreateIndex
CREATE INDEX "outreach_leads_score_idx" ON "outreach_leads"("score");

-- CreateIndex
CREATE INDEX "outreach_leads_importId_idx" ON "outreach_leads"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_users_userId_key" ON "crm_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_users_telegramId_key" ON "crm_users"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_users_calendarFeedTokenHash_key" ON "crm_users"("calendarFeedTokenHash");

-- CreateIndex
CREATE INDEX "crm_clients_status_idx" ON "crm_clients"("status");

-- CreateIndex
CREATE INDEX "crm_clients_assigneeId_idx" ON "crm_clients"("assigneeId");

-- CreateIndex
CREATE INDEX "crm_clients_userId_idx" ON "crm_clients"("userId");

-- CreateIndex
CREATE INDEX "crm_clients_stageId_idx" ON "crm_clients"("stageId");

-- CreateIndex
CREATE INDEX "crm_funnel_stages_funnelId_position_idx" ON "crm_funnel_stages"("funnelId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "crm_tasks_followUpRecipientId_key" ON "crm_tasks"("followUpRecipientId");

-- CreateIndex
CREATE INDEX "crm_tasks_status_position_idx" ON "crm_tasks"("status", "position");

-- CreateIndex
CREATE INDEX "crm_tasks_assigneeId_idx" ON "crm_tasks"("assigneeId");

-- CreateIndex
CREATE INDEX "crm_tasks_clientId_idx" ON "crm_tasks"("clientId");

-- CreateIndex
CREATE INDEX "crm_tasks_leadId_dueAt_idx" ON "crm_tasks"("leadId", "dueAt");

-- CreateIndex
CREATE INDEX "crm_tasks_kind_status_dueAt_idx" ON "crm_tasks"("kind", "status", "dueAt");

-- CreateIndex
CREATE INDEX "crm_tasks_dueAt_idx" ON "crm_tasks"("dueAt");

-- CreateIndex
CREATE INDEX "crm_reminders_sent_remindAt_idx" ON "crm_reminders"("sent", "remindAt");

-- CreateIndex
CREATE INDEX "crm_reminders_taskId_idx" ON "crm_reminders"("taskId");

-- CreateIndex
CREATE INDEX "crm_activity_createdAt_idx" ON "crm_activity"("createdAt");

-- CreateIndex
CREATE INDEX "crm_activity_actorId_createdAt_idx" ON "crm_activity"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_activity_entityType_entityId_createdAt_idx" ON "crm_activity"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_outreachLeadId_key" ON "crm_leads"("outreachLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_sourceRecipientId_key" ON "crm_leads"("sourceRecipientId");

-- CreateIndex
CREATE INDEX "crm_leads_status_createdAt_idx" ON "crm_leads"("status", "createdAt");

-- CreateIndex
CREATE INDEX "crm_leads_assigneeId_idx" ON "crm_leads"("assigneeId");

-- CreateIndex
CREATE INDEX "crm_leads_funnelId_stageId_idx" ON "crm_leads"("funnelId", "stageId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_call_preparations_leadId_key" ON "crm_call_preparations"("leadId");

-- CreateIndex
CREATE INDEX "crm_call_preparations_status_leaseUntil_idx" ON "crm_call_preparations"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "crm_custom_field_definitions_key_key" ON "crm_custom_field_definitions"("key");

-- CreateIndex
CREATE INDEX "crm_custom_field_definitions_entityType_isActive_position_idx" ON "crm_custom_field_definitions"("entityType", "isActive", "position");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_leadId_idx" ON "crm_custom_field_values"("leadId");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_fieldId_valueBoolean_idx" ON "crm_custom_field_values"("fieldId", "valueBoolean");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_fieldId_valueNumber_idx" ON "crm_custom_field_values"("fieldId", "valueNumber");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_fieldId_valueText_idx" ON "crm_custom_field_values"("fieldId", "valueText");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_fieldId_valueDate_idx" ON "crm_custom_field_values"("fieldId", "valueDate");

-- CreateIndex
CREATE UNIQUE INDEX "crm_custom_field_values_fieldId_leadId_key" ON "crm_custom_field_values"("fieldId", "leadId");

-- CreateIndex
CREATE INDEX "crm_deals_clientId_idx" ON "crm_deals"("clientId");

-- CreateIndex
CREATE INDEX "crm_deals_leadId_idx" ON "crm_deals"("leadId");

-- CreateIndex
CREATE INDEX "crm_deals_stageId_position_idx" ON "crm_deals"("stageId", "position");

-- CreateIndex
CREATE INDEX "crm_deals_status_createdAt_idx" ON "crm_deals"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "trial_outreach_userId_key" ON "trial_outreach"("userId");

-- CreateIndex
CREATE INDEX "trial_outreach_status_createdAt_idx" ON "trial_outreach"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sprints_number_key" ON "sprints"("number");

-- CreateIndex
CREATE INDEX "sprints_startsOn_idx" ON "sprints"("startsOn");

-- CreateIndex
CREATE INDEX "outreach_touches_createdAt_idx" ON "outreach_touches"("createdAt");

-- CreateIndex
CREATE INDEX "outreach_touches_userId_createdAt_idx" ON "outreach_touches"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_touches_leadId_step_key" ON "outreach_touches"("leadId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "sprint_reviews_sprintId_key" ON "sprint_reviews"("sprintId");

-- CreateIndex
CREATE UNIQUE INDEX "tg_proxies_host_port_username_key" ON "tg_proxies"("host", "port", "username");

-- CreateIndex
CREATE INDEX "tg_accounts_status_idx" ON "tg_accounts"("status");

-- CreateIndex
CREATE INDEX "tg_warmup_runs_status_nextRunAt_idx" ON "tg_warmup_runs"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "tg_warmup_actions_accountId_createdAt_idx" ON "tg_warmup_actions"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "tg_campaigns_status_idx" ON "tg_campaigns"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tg_campaign_accounts_campaignId_accountId_key" ON "tg_campaign_accounts"("campaignId", "accountId");

-- CreateIndex
CREATE INDEX "tg_recipients_campaignId_status_idx" ON "tg_recipients"("campaignId", "status");

-- CreateIndex
CREATE INDEX "tg_recipients_status_idx" ON "tg_recipients"("status");

-- CreateIndex
CREATE INDEX "tg_recipients_followUpAt_idx" ON "tg_recipients"("followUpAt");

-- CreateIndex
CREATE INDEX "tg_recipients_leadId_idx" ON "tg_recipients"("leadId");

-- CreateIndex
CREATE INDEX "tg_recipients_crmLeadId_idx" ON "tg_recipients"("crmLeadId");

-- CreateIndex
CREATE INDEX "tg_recipients_accountId_sentAt_idx" ON "tg_recipients"("accountId", "sentAt");

-- CreateIndex
CREATE INDEX "tg_recipients_accountId_secondSentAt_idx" ON "tg_recipients"("accountId", "secondSentAt");

-- CreateIndex
CREATE INDEX "tg_recipients_campaignId_plannedAccountId_status_scheduledA_idx" ON "tg_recipients"("campaignId", "plannedAccountId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "tg_reply_reminders_nextAt_idx" ON "tg_reply_reminders"("nextAt");

-- CreateIndex
CREATE INDEX "tg_dialog_messages_recipientId_date_idx" ON "tg_dialog_messages"("recipientId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "tg_dialog_messages_recipientId_tgId_key" ON "tg_dialog_messages"("recipientId", "tgId");

-- CreateIndex
CREATE INDEX "tg_stop_list_createdAt_idx" ON "tg_stop_list"("createdAt");

-- CreateIndex
CREATE INDEX "tg_stop_list_accountId_createdAt_idx" ON "tg_stop_list"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tg_stop_list_kind_value_key" ON "tg_stop_list"("kind", "value");

-- CreateIndex
CREATE INDEX "tg_account_events_accountId_createdAt_idx" ON "tg_account_events"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_months_clientId_month_key" ON "workspace_months"("clientId", "month");

-- CreateIndex
CREATE INDEX "tg_hypotheses_campaignId_idx" ON "tg_hypotheses"("campaignId");

-- AddForeignKey
ALTER TABLE "websites" ADD CONSTRAINT "websites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_tasks" ADD CONSTRAINT "pinned_tasks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captcha_events" ADD CONSTRAINT "captcha_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statistics" ADD CONSTRAINT "statistics_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_history" ADD CONSTRAINT "position_history_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_report_runs" ADD CONSTRAINT "position_report_runs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "position_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_history" ADD CONSTRAINT "balance_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_rewards" ADD CONSTRAINT "daily_rewards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yandex_ad_keywords" ADD CONSTRAINT "yandex_ad_keywords_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "yandex_ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serp_rows" ADD CONSTRAINT "serp_rows_importId_fkey" FOREIGN KEY ("importId") REFERENCES "serp_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_importId_fkey" FOREIGN KEY ("importId") REFERENCES "serp_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_clients" ADD CONSTRAINT "crm_clients_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_clients" ADD CONSTRAINT "crm_clients_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_clients" ADD CONSTRAINT "crm_clients_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "crm_funnels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_clients" ADD CONSTRAINT "crm_clients_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "crm_funnel_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_funnel_stages" ADD CONSTRAINT "crm_funnel_stages_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "crm_funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_followUpRecipientId_fkey" FOREIGN KEY ("followUpRecipientId") REFERENCES "tg_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_reminders" ADD CONSTRAINT "crm_reminders_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "crm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_reminders" ADD CONSTRAINT "crm_reminders_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_outreachLeadId_fkey" FOREIGN KEY ("outreachLeadId") REFERENCES "outreach_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_sourceRecipientId_fkey" FOREIGN KEY ("sourceRecipientId") REFERENCES "tg_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "crm_funnels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "crm_funnel_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_call_preparations" ADD CONSTRAINT "crm_call_preparations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "crm_custom_field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "crm_funnel_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_touches" ADD CONSTRAINT "outreach_touches_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "outreach_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_touches" ADD CONSTRAINT "outreach_touches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_reviews" ADD CONSTRAINT "sprint_reviews_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_accounts" ADD CONSTRAINT "tg_accounts_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "tg_proxies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_warmup_runs" ADD CONSTRAINT "tg_warmup_runs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "tg_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_warmup_actions" ADD CONSTRAINT "tg_warmup_actions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "tg_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_warmup_actions" ADD CONSTRAINT "tg_warmup_actions_runId_fkey" FOREIGN KEY ("runId") REFERENCES "tg_warmup_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_campaign_accounts" ADD CONSTRAINT "tg_campaign_accounts_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "tg_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_campaign_accounts" ADD CONSTRAINT "tg_campaign_accounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "tg_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_recipients" ADD CONSTRAINT "tg_recipients_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "tg_hypotheses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_recipients" ADD CONSTRAINT "tg_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "tg_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_recipients" ADD CONSTRAINT "tg_recipients_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "tg_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_recipients" ADD CONSTRAINT "tg_recipients_plannedAccountId_fkey" FOREIGN KEY ("plannedAccountId") REFERENCES "tg_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_recipients" ADD CONSTRAINT "tg_recipients_crmLeadId_fkey" FOREIGN KEY ("crmLeadId") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_reply_reminders" ADD CONSTRAINT "tg_reply_reminders_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "tg_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_dialog_messages" ADD CONSTRAINT "tg_dialog_messages_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "tg_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_account_events" ADD CONSTRAINT "tg_account_events_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "tg_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_months" ADD CONSTRAINT "workspace_months_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "workspace_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_contracts" ADD CONSTRAINT "workspace_contracts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "workspace_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_hypotheses" ADD CONSTRAINT "tg_hypotheses_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "tg_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- SQL-only constraints preserved from 20261018120000_conversation_badges.
ALTER TABLE "tg_recipients"
 ADD CONSTRAINT "tg_recipients_reply_handled_check" CHECK ("replyHandledThroughTgId" >= 0),
 ADD CONSTRAINT "tg_recipients_conversation_mark_check"
 CHECK ("conversationMark" IS NULL OR "conversationMark" IN ('BLOCKED', 'HISTORY_DELETED'));
