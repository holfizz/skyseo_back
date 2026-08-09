import { Injectable } from '@nestjs/common'
import { AppConfigService } from '../app-config/app-config.service'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from './telegram.service'

/**
 * Детектор «сломалось само приложение», а не «сайта нет в топе».
 *
 * Разница принципиальная и в ней весь смысл: если приложение честно разобрало выдачу и не
 * нашло там сайт клиента — это норма, продвижение только идёт. Тревога нужна там, где данные
 * ПРОТИВОРЕЧАТ друг другу: блоки результатов на странице ЕСТЬ, а разобрано ноль ссылок.
 * Значит вёрстка поисковика уехала и селекторы мертвы — задача потрачена впустую.
 *
 * Считаем ПО-ПК, а не по сети. Так показали прод-данные: поломка приходит не на всех разом
 * (A/B-раскатка поисковика, разные регионы), и правило «доля от сети» не срабатывало бы
 * никогда — при непрерывной двухнедельной поломке в любом окне было максимум 2 битых ПК.
 *
 * Порог держит сервер. Приложение шлёт только факты — оно не решает, что достойно Телеграма.
 */
@Injectable()
export class EngineHealthService {
	// ПК считается «ослепшим», если разборов достаточно для статистики и почти все пустые.
	private readonly MIN_PARSES = 10
	private readonly BLIND_RATIO = 0.8
	// Немедленная тревога: столько ослепших ПК либо такая их доля.
	private readonly TIER_A_PCS = 3
	private readonly TIER_A_SHARE = 0.5
	private readonly TIER_A_MIN_DENOM = 4
	private readonly COOLDOWN_MS = 6 * 60 * 60 * 1000

	constructor(
		private prisma: PrismaService,
		private telegram: TelegramService,
		private appConfig: AppConfigService,
	) {}

	/** Тик проверки. Вызывается планировщиком раз в 30 минут. */
	async check(): Promise<void> {
		try {
			const rows = await this.collect()
			for (const engine of ['yandex', 'google']) {
				await this.evaluateEngine(engine, rows.filter(r => r.engine === engine))
			}
		} catch (e: any) {
			console.error('[EngineHealth] ошибка проверки:', e?.message)
		}
	}

	/**
	 * Собирает по каждому ПК и движку: сколько было разборов выдачи и сколько из них
	 * «слепых» — когда блоки результатов на странице есть, а распарсено ноль.
	 *
	 * Из числителя выброшено всё, что поломкой НЕ является:
	 *   • chromewebdata — страница сетевой ошибки Chrome, у юзера просто оборвалась связь;
	 *   • /sorry/ — Google забанил IP, это отдельная беда и лечится не селекторами;
	 *   • captchaLike — на странице капча, разбирать нечего по определению.
	 */
	private async collect(): Promise<{ executorId: string; engine: string; parses: number; blind: number }[]> {
		return this.prisma.$queryRaw`
			WITH win AS (
				SELECT * FROM execution_events
				WHERE "createdAt" >= now() - interval '24 hours'
				  AND "executorId" IS NOT NULL
				  AND engine IS NOT NULL
			),
			y AS (
				SELECT "executorId", engine, COUNT(*)::int AS parses
				FROM win WHERE type = 'parser' AND stage LIKE 'serp_yield%'
				GROUP BY 1, 2
			),
			b AS (
				SELECT "executorId", engine, COUNT(*)::int AS blind
				FROM win
				WHERE type = 'parser' AND stage LIKE 'serp_zero_dom%'
				  AND COALESCE(details->'dom'->>'hostname', '') <> 'chromewebdata'
				  AND COALESCE(details->>'url', '') NOT LIKE '%/sorry/%'
				  AND COALESCE(details->'dom'->>'captchaLike', 'false') <> 'true'
				  AND (
					(details->'dom'->>'rso') = 'true'
					OR COALESCE((details->'dom'->>'yuRUbf')::int, 0) > 0
					OR COALESCE((details->'dom'->>'tF2Cxc')::int, 0) > 0
					OR COALESCE((details->'dom'->>'liDataCid')::int, 0) > 0
					OR COALESCE((details->'dom'->>'divDataCid')::int, 0) > 0
				  )
				GROUP BY 1, 2
			)
			SELECT y."executorId", y.engine, y.parses, COALESCE(b.blind, 0)::int AS blind
			FROM y LEFT JOIN b USING ("executorId", engine)
		`
	}

	private async evaluateEngine(
		engine: string,
		rows: { executorId: string; parses: number; blind: number }[],
	): Promise<void> {
		const active = rows.filter(r => r.parses >= this.MIN_PARSES)
		if (active.length === 0) return

		const blind = active.filter(r => r.blind / r.parses >= this.BLIND_RATIO)
		const share = blind.length / active.length
		const fired =
			blind.length >= this.TIER_A_PCS ||
			(share >= this.TIER_A_SHARE && active.length >= this.TIER_A_MIN_DENOM)

		const key = `engine_health:blind_parser:${engine}`
		const state = await this.readState(key)

		if (!fired) {
			// Проблема закрылась — отвечаем на исходное сообщение, чтобы не плодить ленту.
			if (state?.openedAt) {
				await this.telegram.sendAdminNotification(
					`✅ <b>Починилось: ${this.engineName(engine)} снова разбирает выдачу</b>\n\n` +
					`Слепых ПК больше нет. Проблема держалась с ${this.fmt(state.openedAt)}.`,
					undefined,
					state.msgId ?? undefined,
				)
				await this.appConfig.set(key, '')
			}
			return
		}

		// Тревога открыта — повторяем только при заметном ухудшении, иначе молчим до конца кулдауна.
		const now = Date.now()
		if (state?.openedAt) {
			const grew = blind.length >= (state.pcs ?? 0) + 2
			const cooled = now - (state.lastAlertAt ?? 0) >= this.COOLDOWN_MS
			if (!grew && !cooled) return
		}

		const sample = blind.sort((a, b) => b.blind - a.blind)[0]
		const totalBlind = blind.reduce((s, r) => s + r.blind, 0)
		const totalParses = blind.reduce((s, r) => s + r.parses, 0)
		const versions = await this.versionsOf(blind.map(r => r.executorId))

		const text =
			`🔴 <b>ДВИЖОК СЛОМАН: ${this.engineName(engine)} не разбирает выдачу</b>\n\n` +
			`Блоки результатов на странице есть, а приложение разобрало 0 ссылок.\n` +
			`Это <b>не</b> «сайта нет в топе» — приложение не видит выдачу вообще.\n\n` +
			`Масштаб: <b>${blind.length}</b> ПК из ${active.length}, работавших с ${this.engineName(engine)} за сутки (${Math.round(share * 100)}%).\n` +
			`Слепых разборов: <b>${totalBlind}</b> из ${totalParses}.\n` +
			(sample ? `Худший ПК: ${sample.blind} из ${sample.parses}.\n` : '') +
			(versions ? `Версии: ${versions}\n` : '') +
			`\nСмотреть: /holfizz/logs`

		const msgId = await this.telegram.sendAdminNotification(text)
		await this.writeState(key, {
			openedAt: state?.openedAt ?? new Date().toISOString(),
			lastAlertAt: now,
			pcs: blind.length,
			msgId: state?.msgId ?? msgId,
		})
	}

	/** Версии приложения у сломанных ПК — подсказывает, откатывать релиз или чинить селекторы. */
	private async versionsOf(ids: string[]): Promise<string> {
		try {
			const users = await this.prisma.user.findMany({
				where: { id: { in: ids } },
				select: { appVersion: true },
			})
			const counts = new Map<string, number>()
			for (const u of users) {
				const v = u.appVersion || 'неизвестна'
				counts.set(v, (counts.get(v) ?? 0) + 1)
			}
			return Array.from(counts.entries()).map(([v, n]) => `${v} (${n})`).join(', ')
		} catch {
			return ''
		}
	}

	// Состояние держим в БД, а не в памяти: иначе оно обнуляется на каждом деплое,
	// и при тике раз в 30 минут владелец получает повторную тревогу сразу после выката.
	private async readState(key: string): Promise<any | null> {
		try {
			const raw = await this.appConfig.get(key, '')
			return raw ? JSON.parse(raw) : null
		} catch {
			return null
		}
	}

	private async writeState(key: string, value: any): Promise<void> {
		try {
			await this.appConfig.set(key, JSON.stringify(value))
		} catch (_) {}
	}

	private engineName(engine: string): string {
		return engine === 'yandex' ? 'Яндекс' : 'Google'
	}

	private fmt(iso: string): string {
		try {
			return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК'
		} catch {
			return iso
		}
	}
}
