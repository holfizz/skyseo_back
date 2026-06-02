import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

// Инференс заброшенности приложения (на Mac хук удаления невозможен, поэтому считаем по активности).
// Сигнал «жив» = свежайший из ДВУХ app-only событий:
//   - последнее выполненное задание (Execution.completedAt при status = COMPLETED);
//   - последний heartbeat (users.lastSeenAt — его шлёт ТОЛЬКО приложение при старте и раз в час, веб его не трогает).
// Раз в сутки:
//   - был ACTIVE/REINSTALLED, но оба сигнала молчат ≥7 дней (приложение не открывали и заданий нет) → UNINSTALLED;
//   - был UNINSTALLED, но снова открыл приложение или выполнил задание за 7 дней → ACTIVE.
// GREATEST в Postgres игнорирует NULL: у кого нет ни одного app-сигнала — под условие не попадает.
// Логин из приложения и так ставит ACTIVE/REINSTALLED сразу; Windows-beacon ставит UNINSTALLED при удалении.
const INACTIVE_DAYS = 7

@Injectable()
export class AppStatusCronService implements OnModuleInit {
	private readonly logger = new Logger(AppStatusCronService.name)

	constructor(private prisma: PrismaService) {}

	onModuleInit() {
		// Прогон вскоре после старта + далее раз в сутки. Интервал не держит процесс (unref).
		setTimeout(() => this.run(), 30_000)
		setInterval(() => this.run(), 24 * 60 * 60 * 1000).unref()
	}

	private async run() {
		const cutoff = new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000)
		try {
			// Приложение молчит ≥7 дней (нет ни заданий, ни heartbeat) → удалил/забросил
			const uninstalled = await this.prisma.$executeRaw`
				UPDATE users u
				SET "appStatus" = 'UNINSTALLED'::"AppStatus"
				WHERE u."appStatus" IN ('ACTIVE'::"AppStatus", 'REINSTALLED'::"AppStatus")
					AND GREATEST(
						(
							SELECT MAX(e."completedAt")
							FROM executions e
							WHERE e."executorId" = u.id AND e.status = 'COMPLETED'::"ExecutionStatus"
						),
						u."lastSeenAt"
					) < ${cutoff}
			`
			// Снова открыл приложение или выполнил задание за последние 7 дней → вернуть в ACTIVE
			const revived = await this.prisma.$executeRaw`
				UPDATE users u
				SET "appStatus" = 'ACTIVE'::"AppStatus"
				WHERE u."appStatus" = 'UNINSTALLED'::"AppStatus"
					AND GREATEST(
						(
							SELECT MAX(e."completedAt")
							FROM executions e
							WHERE e."executorId" = u.id AND e.status = 'COMPLETED'::"ExecutionStatus"
						),
						u."lastSeenAt"
					) >= ${cutoff}
			`
			if (uninstalled > 0 || revived > 0) {
				this.logger.log(`appStatus инференс: UNINSTALLED +${uninstalled}, ACTIVE +${revived}`)
			}
		} catch (e) {
			this.logger.error('Инференс appStatus не выполнен', e as Error)
		}
	}
}
