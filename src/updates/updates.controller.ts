import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common'
import { Platform } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

@Controller('updates')
export class UpdatesController {
	constructor(private prisma: PrismaService) {}

	@Get('check/:platform/:currentVersion')
	async checkForUpdates(
		@Param('platform') platformString: string,
		@Param('currentVersion') currentVersion: string,
	) {
		// Конвертируем строку в enum
		const platformMap: Record<string, Platform> = {
			'darwin-arm64': Platform.DARWIN_ARM64,
			'darwin-x64': Platform.DARWIN_X64,
			'win32-x64': Platform.WIN32_X64,
			'win32-ia32': Platform.WIN32_IA32,
		}

		const platform = platformMap[platformString]
		if (!platform) {
			return {
				updateAvailable: false,
				currentVersion,
				message: 'Unsupported platform',
			}
		}

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
			platform: Platform
			downloadUrl: string
			sha512: string
			fileSize: number
			releaseNotes: string[]
			mandatory?: boolean
		},
	) {
		return await this.prisma.appVersion.create({
			data: {
				version: data.version,
				platform: data.platform,
				downloadUrl: data.downloadUrl,
				sha512: data.sha512,
				fileSize: data.fileSize,
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

	// Endpoint для latest-mac.yml (нужен для electron-updater)
	@Get('latest-mac.yml')
	async getLatestMacYml(@Res({ passthrough: false }) res: any) {
		// Получаем версии для macOS из БД
		const arm64Version = await this.prisma.appVersion.findFirst({
			where: { platform: Platform.DARWIN_ARM64, isActive: true },
			orderBy: { createdAt: 'desc' },
		})

		const x64Version = await this.prisma.appVersion.findFirst({
			where: { platform: Platform.DARWIN_X64, isActive: true },
			orderBy: { createdAt: 'desc' },
		})

		if (!arm64Version && !x64Version) {
			return res.status(404).json({ error: 'No macOS versions available' })
		}

		// Используем ARM64 версию как основную
		const mainVersion = arm64Version || x64Version

		// Генерируем YAML
		const yml = `version: ${mainVersion.version}
files:
  - url: ${arm64Version?.downloadUrl || ''}
    sha512: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
    size: 150000000
  - url: ${x64Version?.downloadUrl || ''}
    sha512: abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
    size: 150000000
path: ${arm64Version?.downloadUrl || x64Version?.downloadUrl || ''}
sha512: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
releaseDate: '${mainVersion.createdAt.toISOString()}'`

		res.setHeader('Content-Type', 'text/yaml')
		return res.send(yml)
	}

	// Endpoint для latest.yml (Windows)
	@Get('latest.yml')
	async getLatestYml(@Res({ passthrough: false }) res: any) {
		// Получаем версии для Windows из БД
		const x64Version = await this.prisma.appVersion.findFirst({
			where: { platform: Platform.WIN32_X64, isActive: true },
			orderBy: { createdAt: 'desc' },
		})

		const ia32Version = await this.prisma.appVersion.findFirst({
			where: { platform: Platform.WIN32_IA32, isActive: true },
			orderBy: { createdAt: 'desc' },
		})

		if (!x64Version && !ia32Version) {
			return res.status(404).json({ error: 'No Windows versions available' })
		}

		// Используем x64 версию как основную
		const mainVersion = x64Version || ia32Version

		// Генерируем YAML
		const yml = `version: ${mainVersion.version}
files:
  - url: ${x64Version?.downloadUrl || ''}
    sha512: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
    size: 150000000
  - url: ${ia32Version?.downloadUrl || ''}
    sha512: abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
    size: 150000000
path: ${x64Version?.downloadUrl || ia32Version?.downloadUrl || ''}
sha512: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
releaseDate: '${mainVersion.createdAt.toISOString()}'`

		res.setHeader('Content-Type', 'text/yaml')
		return res.send(yml)
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
