import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Controller('updates')
export class UpdatesController {
	constructor(private prisma: PrismaService) {}

	@Get('check/:platform/:currentVersion')
	async checkForUpdates(
		@Param('platform') platform: string,
		@Param('currentVersion') currentVersion: string,
	) {
		// Получаем последнюю версию для платформы из БД
		const latestVersion = await this.prisma.appVersion.findFirst({
			where: {
				platform,
				isActive: true,
			},
			orderBy: {
				createdAt: 'desc',
			},
		})

		if (!latestVersion) {
			return {
				updateAvailable: false,
				currentVersion,
				message: 'No updates available for this platform',
			}
		}

		const needsUpdate =
			this.compareVersions(currentVersion, latestVersion.version) < 0

		if (!needsUpdate) {
			return {
				updateAvailable: false,
				currentVersion,
				latestVersion: latestVersion.version,
			}
		}

		return {
			updateAvailable: true,
			currentVersion,
			latestVersion: latestVersion.version,
			downloadUrl: latestVersion.downloadUrl,
			releaseNotes: latestVersion.releaseNotes,
			mandatory: latestVersion.mandatory,
		}
	}

	@Get('latest')
	async getLatestVersion() {
		const versions = await this.prisma.appVersion.findMany({
			where: { isActive: true },
			orderBy: { createdAt: 'desc' },
			take: 4, // По одной для каждой платформы
		})

		return {
			versions: versions.map(v => ({
				platform: v.platform,
				version: v.version,
				downloadUrl: v.downloadUrl,
				releaseNotes: v.releaseNotes,
				mandatory: v.mandatory,
			})),
		}
	}

	// Админский endpoint для добавления новой версии
	@Post('admin/version')
	async createVersion(
		@Body()
		data: {
			version: string
			platform: string
			downloadUrl: string
			releaseNotes: string[]
			mandatory?: boolean
		},
	) {
		return await this.prisma.appVersion.create({
			data: {
				version: data.version,
				platform: data.platform,
				downloadUrl: data.downloadUrl,
				releaseNotes: data.releaseNotes,
				mandatory: data.mandatory || false,
			},
		})
	}

	// Админский endpoint для деактивации версии
	@Put('admin/version/:id/deactivate')
	async deactivateVersion(@Param('id') id: string) {
		return await this.prisma.appVersion.update({
			where: { id },
			data: { isActive: false },
		})
	}

	private compareVersions(version1: string, version2: string): number {
		const v1parts = version1.split('.').map(Number)
		const v2parts = version2.split('.').map(Number)

		for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
			const v1part = v1parts[i] || 0
			const v2part = v2parts[i] || 0

			if (v1part < v2part) return -1
			if (v1part > v2part) return 1
		}

		return 0
	}
}
