import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { UsersService } from '../users/users.service'
import { CompleteExecutionDto, FailExecutionDto, LogExecutionEventDto } from './dto'

@Injectable()
export class ExecutionsService {
	constructor(
		private prisma: PrismaService,
		private usersService: UsersService,
		private telegram: TelegramService,
	) {}

	// Получить начало текущей недели (понедельник 00:00)
	private getWeekStart(date: Date = new Date()): Date {
		const d = new Date(date)
		const day = d.getDay()
		const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Понедельник
		d.setDate(diff)
		d.setHours(0, 0, 0, 0)
		return d
	}

	async startExecution(
		taskId: string,
		executorId: string,
		ipAddress?: string,
		userAgent?: string,
	) {
		return this.prisma.$transaction(async tx => {
			const task = await tx.task.findUnique({
				where: { id: taskId },
				include: { website: true },
			})

			if (
				!task ||
				task.status !== 'ASSIGNED' ||
				task.assignedExecutorId !== executorId ||
				task.website.userId === executorId
			) {
				throw new Error('Task not available')
			}

			const completedBefore = await tx.execution.count({
				where: {
					executorId,
					taskId,
					status: 'COMPLETED',
				},
			})

			if (completedBefore > 0) {
				throw new Error('Вы уже выполнили эту задачу')
			}

			const claimed = await tx.task.updateMany({
				where: {
					id: taskId,
					status: 'ASSIGNED',
					assignedExecutorId: executorId,
				},
				data: { status: 'IN_PROGRESS' },
			})

			if (claimed.count !== 1) {
				throw new Error('Task not available')
			}

			return tx.execution.create({
				data: {
					taskId,
					executorId,
					websiteId: task.websiteId,
					ipAddress,
					userAgent,
					weekStart: this.getWeekStart(),
				},
			})
		})
	}

	async completeExecution(executionId: string, dto: CompleteExecutionDto) {
		console.log(`[completeExecution] id=${executionId} dto=`, JSON.stringify(dto))
		const execution = await this.prisma.execution.findUnique({
			where: { id: executionId },
			include: {
				task: {
					include: {
						website: {
							include: { user: true },
						},
					},
				},
			},
		})

		if (!execution) {
			throw new Error('Execution not found')
		}

		if (execution.status !== 'IN_PROGRESS') {
			return execution
		}

		if (dto.duration < 30) {
			throw new Error('Execution duration too short (minimum 30 seconds)')
		}

		if (dto.duration > 3600) {
			throw new Error('Execution duration too long (maximum 1 hour)')
		}

		if (dto.pagesVisited < 2 || dto.pagesVisited > 30) {
			throw new Error('Invalid pages visited count (2-30)')
		}

		if (dto.position && (dto.position < 1 || dto.position > 50)) {
			throw new Error('Invalid position (1-50)')
		}

		if (
			execution.task.type === 'SEARCH_KEYWORD' &&
			dto.foundInTop &&
			!dto.position
		) {
			throw new Error('Position required when site found in top')
		}

		let pointsEarned = 0
		let pointsSpent = 0
		const isSearchTask =
			execution.task.type === 'SEARCH_KEYWORD' ||
			execution.task.type === 'SEARCH_AND_VISIT'
		const hasPerEngineResult =
			dto.yandexCompleted !== undefined ||
			dto.googleCompleted !== undefined ||
			dto.yandexFoundInTop !== undefined ||
			dto.googleFoundInTop !== undefined
		const engineRewards: Array<{
			engine: 'yandex' | 'google'
			label: string
			foundInTop: boolean
			pointsEarned: number
			pointsSpent: number
		}> = []

		if (isSearchTask) {
			if (hasPerEngineResult) {
				const addEngineReward = (
					engine: 'yandex' | 'google',
					completed: boolean | undefined,
					foundInTop: boolean | undefined,
				) => {
					if (!completed) return

					const earned = foundInTop ? 15 : 5
					const spent = foundInTop ? 30 : 10
					engineRewards.push({
						engine,
						label: engine === 'yandex' ? 'Яндекс' : 'Google',
						foundInTop: !!foundInTop,
						pointsEarned: earned,
						pointsSpent: spent,
					})
					pointsEarned += earned
					pointsSpent += spent
				}

				addEngineReward('yandex', dto.yandexCompleted, dto.yandexFoundInTop)
				addEngineReward('google', dto.googleCompleted, dto.googleFoundInTop)
			} else if (dto.foundInTop) {
				pointsEarned = 15
				pointsSpent = 30
			} else {
				pointsEarned = 5
				pointsSpent = 10
			}
		} else if (execution.task.type === 'EXTERNAL_LINK') {
			pointsEarned = 5
			pointsSpent = 10
		}

		if (isSearchTask && hasPerEngineResult && engineRewards.length === 0) {
			throw new Error('No completed search engine results')
		}

		const taskDescription = execution.task.keyword
			? `Поиск "${execution.task.keyword}" на ${execution.task.website.url}`
			: `Переход по ссылке ${execution.task.externalUrl}`
		const resultText = (foundInTop: boolean) =>
			foundInTop ? 'найдено в поиске' : 'не найдено в поиске'
		const overallFoundInTop = hasPerEngineResult
			? engineRewards.some(reward => reward.foundInTop)
			: dto.foundInTop
		const primaryPosition = hasPerEngineResult
			? dto.yandexPosition ?? dto.googlePosition ?? dto.position ?? null
			: dto.position
		const yandexFoundInTop = hasPerEngineResult
			? (dto.yandexCompleted ? !!dto.yandexFoundInTop : null)
			: dto.yandexPosition != null
		const googleFoundInTop = hasPerEngineResult
			? (dto.googleCompleted ? !!dto.googleFoundInTop : null)
			: dto.googlePosition != null
		const earnedDescription = `${taskDescription} (${resultText(overallFoundInTop)})`
		const spentDescription = `Задача выполнена: ${taskDescription} (${resultText(overallFoundInTop)})`
		const earnedHistoryItems = engineRewards.length > 0
			? engineRewards.map(reward => ({
				amount: reward.pointsEarned,
				description: `${taskDescription} — ${reward.label} (${resultText(reward.foundInTop)})`,
			}))
			: [{ amount: pointsEarned, description: earnedDescription }]
		const spentHistoryItems = engineRewards.length > 0
			? engineRewards.map(reward => ({
				amount: -reward.pointsSpent,
				description: `Задача выполнена: ${taskDescription} — ${reward.label} (${resultText(reward.foundInTop)})`,
			}))
			: [{ amount: -pointsSpent, description: spentDescription }]
		const shouldSavePosition =
			execution.task.type === 'SEARCH_KEYWORD' ||
			execution.task.type === 'SEARCH_AND_VISIT'

		const completion = await this.prisma.$transaction(async tx => {
			const owner = await tx.user.findUnique({
				where: { id: execution.task.website.userId },
				select: { balance: true },
			})
			const ownerBalance = owner?.balance ?? 0

			if (ownerBalance < pointsSpent) {
				console.log(
					`[ExecutionsService] Недостаточно баллов у владельца (${ownerBalance} < ${pointsSpent}). Задача деактивируется.`,
				)
				const claimed = await tx.execution.updateMany({
					where: { id: executionId, status: 'IN_PROGRESS' },
					data: {
						status: 'FAILED',
						foundInTop: false,
						targetVisited: dto.targetVisited ?? false,
						directNavigationUsed: dto.directNavigationUsed ?? false,
						completionKind: 'SKIPPED',
						pagesVisited: dto.pagesVisited,
						duration: dto.duration,
						completedAt: new Date(),
						pointsEarned: 0,
						pointsSpent: 0,
					},
				})
				await tx.task.update({
					where: { id: execution.taskId },
					data: {
						isActive: false,
						status: 'PENDING',
						assignedAt: null,
						assignedExecutorId: null,
					},
				})
				return {
					execution: await tx.execution.findUnique({ where: { id: executionId } }),
					ownerBalanceFailed: claimed.count === 1,
				}
			}

			const claimed = await tx.execution.updateMany({
				where: { id: executionId, status: 'IN_PROGRESS' },
				data: {
					status: 'COMPLETED',
					foundInTop: overallFoundInTop,
					position: primaryPosition,
					yandexFoundInTop,
					googleFoundInTop,
					yandexPosition: dto.yandexPosition,
					googlePosition: dto.googlePosition,
					targetVisited: dto.targetVisited ?? false,
					directNavigationUsed: dto.directNavigationUsed ?? false,
					completionKind: dto.completionKind ?? 'NORMAL',
					pagesVisited: dto.pagesVisited,
					duration: dto.duration,
					completedAt: new Date(),
					pointsEarned,
					pointsSpent,
				},
			})

			if (claimed.count !== 1) {
				return {
					execution: await tx.execution.findUnique({ where: { id: executionId } }),
					ownerBalanceFailed: false,
				}
			}

			await tx.user.update({
				where: { id: execution.executorId },
				data: { balance: { increment: pointsEarned } },
			})
			for (const item of earnedHistoryItems) {
				await tx.balanceHistory.create({
					data: {
						userId: execution.executorId,
						amount: item.amount,
						type: 'TASK_EARNED',
						description: item.description,
						taskId: execution.taskId,
					},
				})
			}

			await tx.user.update({
				where: { id: execution.task.website.userId },
				data: { balance: { increment: -pointsSpent } },
			})
			for (const item of spentHistoryItems) {
				await tx.balanceHistory.create({
					data: {
						userId: execution.task.website.userId,
						amount: item.amount,
						type: 'TASK_SPENT',
						description: item.description,
						taskId: execution.taskId,
					},
				})
			}

			await tx.task.update({
				where: { id: execution.taskId },
				data: { status: 'PENDING', assignedAt: null, assignedExecutorId: null },
			})

			if (
				shouldSavePosition &&
				(hasPerEngineResult
					? (dto.yandexPosition || dto.googlePosition)
					: (dto.yandexPosition || dto.googlePosition || dto.position))
			) {
				await tx.positionHistory.create({
					data: {
						taskId: execution.taskId,
						yandexPosition: hasPerEngineResult
							? dto.yandexPosition ?? null
							: dto.yandexPosition ?? dto.position ?? null,
						googlePosition: hasPerEngineResult
							? dto.googlePosition ?? null
							: dto.googlePosition ?? dto.position ?? null,
					},
				})
			}

			return {
				execution: await tx.execution.findUnique({ where: { id: executionId } }),
				ownerBalanceFailed: false,
			}
		})

		if (completion.ownerBalanceFailed) {
			throw new Error('Недостаточно баллов у владельца сайта. Задача деактивирована.')
		}

		console.log(`[ExecutionsService] Execution ${executionId} completed idempotently`)
		return completion.execution
	}

	async failExecution(executionId: string, dto: FailExecutionDto) {
		const execution = await this.prisma.execution.findUnique({
			where: { id: executionId },
			select: { id: true, taskId: true, status: true },
		})

		if (!execution) {
			throw new Error('Execution not found')
		}

		if (execution.status !== 'IN_PROGRESS') {
			return execution
		}

		const updatedExecution = await this.prisma.$transaction(async tx => {
			const claimed = await tx.execution.updateMany({
				where: { id: executionId, status: 'IN_PROGRESS' },
				data: {
					status: 'FAILED',
					foundInTop: false,
					failureReason: dto.failureReason,
					targetVisited: dto.targetVisited ?? false,
					directNavigationUsed: dto.directNavigationUsed ?? false,
					completionKind: 'SKIPPED',
					pagesVisited: dto.pagesVisited ?? 0,
					duration: dto.duration ?? 0,
					completedAt: new Date(),
				},
			})

			if (claimed.count !== 1) {
				return tx.execution.findUnique({ where: { id: executionId } })
			}

			await tx.task.update({
				where: { id: execution.taskId },
				data: { status: 'PENDING', assignedAt: null, assignedExecutorId: null },
			})

			return tx.execution.findUnique({ where: { id: executionId } })
		})

		console.log(
			`[ExecutionsService] Execution ${executionId} FAILED (${dto.failureReason}), task ${execution.taskId} returned to PENDING`,
		)

		// Авто-ограничение ключевика: 10 подряд NOT_IN_SERP и ни разу не найден
		if (dto.failureReason === 'NOT_IN_SERP') {
			const everFound = await this.prisma.execution.count({
				where: { taskId: execution.taskId, status: 'COMPLETED', foundInTop: true },
			})
			if (everFound === 0) {
				const recentExecs = await this.prisma.execution.findMany({
					where: { taskId: execution.taskId, completedAt: { not: null } },
					orderBy: { completedAt: 'desc' },
					select: { status: true, failureReason: true },
					take: 20,
				})
				let consecutive = 0
				for (const e of recentExecs) {
					if (e.status === 'FAILED' && e.failureReason === 'NOT_IN_SERP') consecutive++
					else break
				}
				if (consecutive >= 10) {
					const task = await this.prisma.task.update({
						where: { id: execution.taskId },
						data: { keywordStatus: 'RESTRICTED' },
						include: { website: { select: { url: true, user: { select: { email: true } } } } },
					})
					console.log(`[ExecutionsService] Задача ${execution.taskId} авто-ограничена (10 подряд NOT_IN_SERP)`)
					await this.telegram.sendAdminNotification(
						`⚠️ <b>Ключевик авто-ограничен</b>\n\n` +
						`🔑 Ключевик: <b>${task.keyword}</b>\n` +
						`🌐 Сайт: ${task.website.url}\n` +
						`👤 Владелец: ${task.website.user.email}\n` +
						`📊 Причина: 10 подряд исполнителей не нашли сайт в выдаче\n\n` +
						`ℹ️ Ключевик ограничен автоматически. Владельцу показывается уведомление в интерфейсе.`,
					)
				}
			}
		}

		return updatedExecution
	}

	async logExecutionEvent(
		executionId: string,
		executorId: string,
		dto: LogExecutionEventDto,
	) {
		const execution = await this.prisma.execution.findFirst({
			where: {
				id: executionId,
				executorId,
			},
			select: {
				id: true,
				taskId: true,
			},
		})

		if (!execution) {
			throw new Error('Execution not found')
		}

		return this.prisma.executionEvent.create({
			data: {
				executionId,
				taskId: dto.taskId ?? execution.taskId,
				executorId,
				engine: dto.engine,
				type: dto.type,
				stage: dto.stage,
				details: dto.details as any,
			},
		})
	}

	async getExecutionHistory(userId: string, limit = 50) {
		return this.prisma.execution.findMany({
			where: { executorId: userId },
			include: {
				task: {
					include: {
						website: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
			take: limit,
		})
	}

	async logCaptchaEvent(userId: string, engine: string, resolved: boolean) {
		return this.prisma.captchaEvent.create({
			data: { userId, engine, resolved },
		})
	}
}
