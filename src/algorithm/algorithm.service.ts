/**
 * Доставка алгоритма. См. ALGO_DELIVERY_TZ.md.
 *
 * Роль сервера — ХРАНИЛИЩЕ и РАЗДАЧА, не источник доверия. Сервер НЕ подписывает бандлы
 * (приватный ключ только у владельца, офлайн). Он лишь проверяет подпись при загрузке,
 * чтобы в базу не попал мусор, и отдаёт готовый подписанный бандл нужным ПК.
 * Финальная граница доверия — проверка подписи в приложении (AlgoLoader).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AlgoBundleStatus } from '@prisma/client'
import { createHash, createPublicKey, verify } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { AppConfigService } from '../app-config/app-config.service'
import { ALGO_PUBLIC_KEY } from './pubkey'

const KEY_KILL = 'algo_kill_switch' // '1' = вся сеть на builtin, немедленно

export interface SignedBundle {
	manifest: {
		version: number
		contract: number
		minAppVersion: string
		floor: number
		sha256: string
		size: number
		createdAt: string
	}
	sig: string
	payload: string
}

@Injectable()
export class AlgorithmService {
	constructor(
		private prisma: PrismaService,
		private appConfig: AppConfigService,
	) {}

	// ── что отдать конкретному ПК ────────────────────────────────────────────
	// Учитываем pin (канарейка): если у ПК закреплена версия — отдаём её, иначе LIVE.
	async currentForExecutor(userId: string): Promise<{ kill: boolean; bundle: SignedBundle | null }> {
		if ((await this.appConfig.get(KEY_KILL, '0')) === '1') return { kill: true, bundle: null }

		const asg = await this.prisma.algorithmAssignment.findUnique({ where: { userId } })
		let target
		if (asg?.pinnedVersion != null) {
			target = await this.prisma.algorithmBundle.findUnique({ where: { version: asg.pinnedVersion } })
		} else {
			target = await this.prisma.algorithmBundle.findFirst({
				where: { status: 'LIVE' },
				orderBy: { version: 'desc' },
			})
		}
		if (!target) return { kill: false, bundle: null }
		return { kill: false, bundle: target.bundle as unknown as SignedBundle }
	}

	// ── телеметрия применения от ПК ──────────────────────────────────────────
	async report(userId: string, appliedVersion: number | null, appVersion: string | null, lastError: string | null) {
		await this.prisma.algorithmAssignment.upsert({
			where: { userId },
			create: { userId, appliedVersion, appVersion, lastError },
			update: { appliedVersion, appVersion, lastError },
		})
		return { ok: true }
	}

	// ── админ: проверить подпись и сохранить бандл ───────────────────────────
	async createBundle(raw: unknown, label: string, notes: string | null, byEmail: string | null) {
		const bundle = this.assertValidSignedBundle(raw)
		const m = bundle.manifest
		const exists = await this.prisma.algorithmBundle.findUnique({ where: { version: m.version } })
		if (exists) throw new BadRequestException(`Версия ${m.version} уже загружена`)
		return this.prisma.algorithmBundle.create({
			data: {
				version: m.version,
				label: label?.trim() || `Версия ${m.version}`,
				notes: notes?.trim() || null,
				status: 'DRAFT',
				floor: m.floor,
				minAppVersion: m.minAppVersion,
				bundle: bundle as any,
				sha256: m.sha256,
				size: m.size,
				createdByEmail: byEmail,
			},
		})
	}

	async list() {
		const [bundles, assignments] = await Promise.all([
			this.prisma.algorithmBundle.findMany({ orderBy: { version: 'desc' }, take: 50 }),
			this.prisma.algorithmAssignment.groupBy({ by: ['appliedVersion'], _count: { userId: true } }),
		])
		const onVersion = new Map<number | null, number>()
		for (const a of assignments) onVersion.set(a.appliedVersion, a._count.userId)
		const kill = (await this.appConfig.get(KEY_KILL, '0')) === '1'
		return {
			kill,
			bundles: bundles.map(b => ({
				version: b.version,
				label: b.label,
				notes: b.notes,
				status: b.status,
				floor: b.floor,
				minAppVersion: b.minAppVersion,
				size: b.size,
				createdByEmail: b.createdByEmail,
				rollbackReason: b.rollbackReason,
				createdAt: b.createdAt,
				machinesApplied: onVersion.get(b.version) ?? 0,
			})),
			// сколько ПК на каком (для шапки статуса)
			appliedCounts: [...onVersion.entries()].map(([v, n]) => ({ version: v, machines: n })),
		}
	}

	// ── выкатка: DRAFT/CANARY/ROLLED_BACK → LIVE; прежний LIVE становится ROLLED_BACK ──
	async promote(version: number) {
		const b = await this.prisma.algorithmBundle.findUnique({ where: { version } })
		if (!b) throw new NotFoundException('Версия не найдена')
		await this.prisma.$transaction([
			this.prisma.algorithmBundle.updateMany({ where: { status: 'LIVE' }, data: { status: 'ROLLED_BACK' } }),
			this.prisma.algorithmBundle.update({ where: { version }, data: { status: 'LIVE', rollbackReason: null } }),
			// LIVE отменяет все пины: канарейка закончилась, вся сеть на этой версии
			this.prisma.algorithmAssignment.updateMany({ where: { pinnedVersion: { not: null } }, data: { pinnedVersion: null } }),
		])
		return { ok: true }
	}

	// ── канарейка: закрепить версию за списком ПК ────────────────────────────
	async canary(version: number, userIds: string[]) {
		const b = await this.prisma.algorithmBundle.findUnique({ where: { version } })
		if (!b) throw new NotFoundException('Версия не найдена')
		await this.prisma.algorithmBundle.update({ where: { version }, data: { status: 'CANARY' } })
		for (const userId of userIds) {
			await this.prisma.algorithmAssignment.upsert({
				where: { userId },
				create: { userId, pinnedVersion: version },
				update: { pinnedVersion: version },
			})
		}
		return { ok: true, pinned: userIds.length }
	}

	// ── откат: снять LIVE, вернуть сеть на предыдущую LIVE-версию или builtin ──
	async rollback(version: number, reason: string | null) {
		const b = await this.prisma.algorithmBundle.findUnique({ where: { version } })
		if (!b) throw new NotFoundException('Версия не найдена')
		await this.prisma.algorithmBundle.update({
			where: { version },
			data: { status: 'ROLLED_BACK', rollbackReason: reason?.trim() || 'откат вручную' },
		})
		// поднимаем предыдущую живую (наибольшую из уже выкаченных), иначе сеть уйдёт на builtin
		const prev = await this.prisma.algorithmBundle.findFirst({
			where: { status: 'ROLLED_BACK', version: { lt: version } },
			orderBy: { version: 'desc' },
		})
		if (prev) await this.prisma.algorithmBundle.update({ where: { version: prev.version }, data: { status: 'LIVE' } })
		return { ok: true, revertedTo: prev?.version ?? null }
	}

	// ── kill-switch ──────────────────────────────────────────────────────────
	async setKill(on: boolean) {
		await this.appConfig.set(KEY_KILL, on ? '1' : '0')
		return { kill: on }
	}

	// ── валидация загружаемого бандла: подпись тем же ключом, что в приложении ──
	private assertValidSignedBundle(raw: any): SignedBundle {
		if (!raw || typeof raw !== 'object') throw new BadRequestException('Не JSON')
		const { manifest, sig, payload } = raw
		if (!manifest || typeof sig !== 'string' || typeof payload !== 'string') {
			throw new BadRequestException('Нет manifest/sig/payload')
		}
		if (typeof manifest.version !== 'number' || manifest.version < 1) {
			throw new BadRequestException('Некорректная version в манифесте')
		}
		// sha256 тела
		const body = Buffer.from(payload, 'base64')
		if (createHash('sha256').update(body).digest('hex') !== manifest.sha256) {
			throw new BadRequestException('sha256 тела не сошёлся — бандл повреждён')
		}
		// подпись манифеста (канонический — ключи по алфавиту, как в приложении и algo-sign.js)
		const canonical = JSON.stringify(manifest, Object.keys(manifest).sort())
		const ok = verify(null, Buffer.from(canonical), createPublicKey(ALGO_PUBLIC_KEY), Buffer.from(sig, 'base64'))
		if (!ok) throw new BadRequestException('Подпись не сошлась — бандл подписан не тем ключом')
		return raw as SignedBundle
	}
}
