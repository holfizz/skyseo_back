import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { CompleteExecutionDto, FailExecutionDto, LogExecutionEventDto } from './dto'

@Injectable()
export class ExecutionsService {
	constructor(
		private prisma: PrismaService,
		private usersService: UsersService,
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
		const task = await this.prisma.task.findUnique({
			where: { id: taskId },
			include: { website: true },
		})

		if (!task || task.status !== 'ASSIGNED') {
			throw new Error('Task not available')
		}

			const weekStart = this.getWeekStart()
			const completedBefore = await this.prisma.execution.count({
				where: {
					executorId,
					taskId,
					status: 'COMPLETED',
				},
			})

			if (completedBefore > 0) {
				throw new Error(
					'Вы уже выполнили эту задачу',
				)
			}

		const execution = await this.prisma.execution.create({
			data: {
				taskId,
				executorId,
				websiteId: task.websiteId,
				ipAddress,
				userAgent,
				weekStart,
			},
		})

		await this.prisma.task.update({
			where: { id: taskId },
			data: { status: 'IN_PROGRESS' },
		})

		return execution
	}

	async completeExecution(executionId: string, dto: CompleteExecutionDto) {
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

		// ЗАЩИТА: Проверка минимальной длительности
		if (dto.duration < 30) {
			throw new Error('Execution duration too short (minimum 30 seconds)')
		}

		// ЗАЩИТА: Проверка максимальной длительности
		if (dto.duration > 600) {
			throw new Error('Execution duration too long (maximum 10 minutes)')
		}

		// ЗАЩИТА: Проверка количества посещенных страниц
		if (dto.pagesVisited < 2 || dto.pagesVisited > 10) {
			throw new Error('Invalid pages visited count (2-10)')
		}

		// ЗАЩИТА: Проверка позиции
		if (dto.position && (dto.position < 1 || dto.position > 50)) {
			throw new Error('Invalid position (1-50)')
		}

		// ЗАЩИТА: Если сайт найден, позиция обязательна для SEARCH_KEYWORD
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

			const updatedExecution = await this.prisma.$transaction(async tx => {
				const owner = await tx.user.findUnique({
					where: { id: execution.task.website.userId },
					select: { balance: true },
				})
				const ownerBalance = owner?.balance ?? 0
				if (ownerBalance < pointsSpent) {
					console.log(
						`[ExecutionsService] Недостаточно баллов у владельца (${ownerBalance} < ${pointsSpent}). Задача деактивируется.`,
					)
					await tx.task.update({
						where: { id: execution.taskId },
						data: { isActive: false, status: 'PENDING' },
					})
					throw new Error('Недостаточно баллов у владельца сайта. Задача деактивирована.')
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
					return tx.execution.findUnique({ where: { id: executionId } })
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
					data: { status: 'PENDING' },
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

				return tx.execution.findUnique({ where: { id: executionId } })
			})

			console.log(`[ExecutionsService] Execution ${executionId} completed idempotently`)
			return updatedExecution
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
					data: { status: 'PENDING' },
				})

				return tx.execution.findUnique({ where: { id: executionId } })
			})

			console.log(
			`[ExecutionsService] Execution ${executionId} FAILED (${dto.failureReason}), task ${execution.taskId} returned to PENDING`,
		)

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
