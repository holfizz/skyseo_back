import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { WinbackService } from '../winback/winback.service'

// Инференс заброшенности приложения (на Mac хук удаления невозможен, поэтому считаем по активности).
// Сигнал «жив» = свежайший из ТРЁХ app-only событий (GREATEST игнорит NULL):
//   - последнее выполненное задание (Execution.completedAt при status = COMPLETED);
//   - последний heartbeat (users.lastSeenAt — шлёт ТОЛЬКО приложение);
//   - последний логин из приложения (users.appLastLoginAt — тоже app-only, надёжнее heartbeat).
// Раз в сутки: ACTIVE/REINSTALLED, но все три сигнала молчат ≥7 дней → UNINSTALLED.
// Возврат в ACTIVE НЕ здесь, а в heartbeat-эндпоинте (users.controller) — иначе суточный «ревайв»
// затирал бы точный UNINSTALLED от Windows-beacon (lastSeenAt свежий за пару часов до удаления).
// Сравнение времени делаем целиком в SQL в UTC, без JS-параметра — чтобы не зависеть от таймзоны сессии БД.
const INACTIVE_DAYS = 7

@Injectable()
export class AppStatusCronService implements OnModuleInit {
	private readonly logger = new Logger(AppStatusCronService.name)

	constructor(
		private prisma: PrismaService,
		private winback: WinbackService,
	) {}

	onModuleInit() {
		// Прогон вскоре после старта + далее раз в сутки. Интервал не держит процесс (unref).
		setTimeout(() => this.run(), 30_000)
		setInterval(() => this.run(), 24 * 60 * 60 * 1000).unref()
	}

	private async run() {
		try {
			// RETURNING id — чтобы знать, кто именно отвалился, и отправить каждому win-back письмо.
			const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
				UPDATE users u
				SET "appStatus" = 'UNINSTALLED'::"AppStatus"
				WHERE u."appStatus" IN ('ACTIVE'::"AppStatus", 'REINSTALLED'::"AppStatus")
					AND GREATEST(
						(
							SELECT MAX(e."completedAt")
							FROM executions e
							WHERE e."executorId" = u.id AND e.status = 'COMPLETED'::"ExecutionStatus"
						),
						u."lastSeenAt",
						u."appLastLoginAt"
					) < (now() AT TIME ZONE 'UTC') - (${INACTIVE_DAYS}::int * interval '1 day')
				RETURNING u.id
			`
			if (rows.length > 0) {
				this.logger.log(`appStatus → UNINSTALLED по тишине ≥${INACTIVE_DAYS}д: ${rows.length}`)
				// Win-back письмо каждому только что отвалившемуся (метод сам идемпотентен и не бросает).
				for (const r of rows) {
					await this.winback.onUninstall(r.id)
				}
			}
		} catch (e) {
			this.logger.error('Инференс appStatus не выполнен', e as Error)
		}
	}
}
