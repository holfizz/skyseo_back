import { Injectable } from '@nestjs/common'
import { Platform } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class AppVersionService {
	constructor(private prisma: PrismaService) {}

	/**
	 * Проверяет версию приложения и возвращает информацию об обновлении
	 */
	async checkVersion(currentVersion: string, platform: string) {
		console.log('[AppVersion] Checking version', {
			currentVersion,
			platform,
		})

		// Преобразуем platform в формат базы данных
		const platformEnum = this.getPlatformEnum(platform)

		// Получаем последнюю активную версию для платформы
		const latestVersion = await this.prisma.appVersion.findFirst({
			where: {
				platform: platformEnum,
				isActive: true,
			},
			orderBy: {
				createdAt: 'desc',
			},
		})

		if (!latestVersion) {
			console.log('[AppVersion] No version found for platform:', platform)
			return {
				updateRequired: false,
				updateAvailable: false,
				currentVersion,
			}
		}

		// Сравниваем версии
		const isOutdated =
			this.compareVersions(currentVersion, latestVersion.version) < 0
		const isMandatory = latestVersion.mandatory && isOutdated

		console.log('[AppVersion] Version check result', {
			currentVersion,
			latestVersion: latestVersion.version,
			isOutdated,
			isMandatory,
		})

		return {
			updateRequired: isMandatory, // Обязательное обновление
			updateAvailable: isOutdated, // Доступно обновление
			currentVersion,
			latestVersion: latestVersion.version,
			downloadUrl: latestVersion.downloadUrl,
			releaseNotes: latestVersion.releaseNotes,
			mandatory: latestVersion.mandatory,
		}
	}

	/**
	 * Сравнивает две версии (формат: "1.0.0")
	 * Возвращает: -1 если v1 < v2, 0 если равны, 1 если v1 > v2
	 */
	private compareVersions(v1: string, v2: string): number {
		const parts1 = v1.split('.').map(Number)
		const parts2 = v2.split('.').map(Number)

		for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
			const part1 = parts1[i] || 0
			const part2 = parts2[i] || 0

			if (part1 < part2) return -1
			if (part1 > part2) return 1
		}

		return 0
	}

	/**
	 * Преобразует platform string в enum
	 */
	private getPlatformEnum(platform: string): Platform {
		const platformMap: Record<string, Platform> = {
			'darwin-arm64': Platform.DARWIN_ARM64,
			'darwin-x64': Platform.DARWIN_X64,
			'win32-x64': Platform.WIN32_X64,
			'win32-ia32': Platform.WIN32_IA32,
		}

		return platformMap[platform] || Platform.WIN32_X64
	}
}
