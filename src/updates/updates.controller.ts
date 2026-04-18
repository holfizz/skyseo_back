import { Controller, Get, Param, Res } from '@nestjs/common'
import { Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'

@Controller('updates')
export class UpdatesController {
	private readonly releasesPath = path.join(process.cwd(), 'releases')

	@Get('check/:platform/:currentVersion')
	async checkForUpdates(
		@Param('platform') platform: string,
		@Param('currentVersion') currentVersion: string,
	) {
		// Простая логика проверки обновлений
		const latestVersion = '1.2.0' // Версия для тестирования
		const needsUpdate = this.compareVersions(currentVersion, latestVersion) < 0

		if (!needsUpdate) {
			return {
				updateAvailable: false,
				currentVersion,
				latestVersion,
			}
		}

		// Формируем URL для загрузки в зависимости от платформы
		const downloadUrls = {
			'darwin-arm64': `https://skyseo.site/v1/api/updates/download/SkySEO-${latestVersion}-arm64.dmg`,
			'darwin-x64': `https://skyseo.site/v1/api/updates/download/SkySEO-${latestVersion}-x64.dmg`,
			'win32-x64': `https://skyseo.site/v1/api/updates/download/SkySEO-${latestVersion}-x64.exe`,
			'win32-ia32': `https://skyseo.site/v1/api/updates/download/SkySEO-${latestVersion}-ia32.exe`,
		}

		return {
			updateAvailable: true,
			currentVersion,
			latestVersion,
			downloadUrl: downloadUrls[platform] || downloadUrls['darwin-arm64'],
			releaseNotes: [
				'Улучшена стабильность работы',
				'Исправлены ошибки в системе обновлений',
				'Добавлены новые функции автоматизации',
			],
			mandatory: false, // Обязательное ли обновление
		}
	}

	@Get('latest')
	async getLatestVersion() {
		return {
			version: '1.2.0',
			releaseDate: new Date().toISOString(),
			releaseNotes: [
				'Улучшена стабильность работы',
				'Исправлены ошибки в системе обновлений',
				'Добавлены новые функции автоматизации',
			],
		}
	}

	// Endpoint для загрузки файлов обновлений
	@Get('download/:filename')
	async downloadFile(
		@Param('filename') filename: string,
		@Res() res: Response,
	) {
		const filePath = path.join(this.releasesPath, filename)

		// Проверяем что файл существует
		if (!fs.existsSync(filePath)) {
			return res.status(404).json({ error: 'File not found' })
		}

		// Проверяем что это разрешенный файл
		const allowedExtensions = ['.dmg', '.exe', '.msi', '.yml']
		const ext = path.extname(filename).toLowerCase()
		if (!allowedExtensions.includes(ext)) {
			return res.status(403).json({ error: 'File type not allowed' })
		}

		// Устанавливаем правильные заголовки
		const stat = fs.statSync(filePath)
		res.setHeader('Content-Length', stat.size)
		res.setHeader('Content-Type', 'application/octet-stream')
		res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

		// Отправляем файл
		const fileStream = fs.createReadStream(filePath)
		fileStream.pipe(res)
	}

	// Endpoint для latest-mac.yml (нужен для electron-updater)
	@Get('latest-mac.yml')
	async getLatestMacYml(@Res() res: Response) {
		const ymlPath = path.join(this.releasesPath, 'latest-mac.yml')

		if (!fs.existsSync(ymlPath)) {
			// Генерируем базовый yml если файл не найден
			const yml = `version: 1.2.0
files:
  - url: SkySEO-1.2.0-arm64.dmg
    sha512: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
    size: 150000000
  - url: SkySEO-1.2.0-x64.dmg
    sha512: abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
    size: 150000000
path: SkySEO-1.2.0-arm64.dmg
sha512: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
releaseDate: '${new Date().toISOString()}'`

			res.setHeader('Content-Type', 'text/yaml')
			return res.send(yml)
		}

		res.setHeader('Content-Type', 'text/yaml')
		const fileStream = fs.createReadStream(ymlPath)
		fileStream.pipe(res)
	}

	// Endpoint для latest.yml (Windows)
	@Get('latest.yml')
	async getLatestYml(@Res() res: Response) {
		const ymlPath = path.join(this.releasesPath, 'latest.yml')

		if (!fs.existsSync(ymlPath)) {
			// Генерируем базовый yml для Windows
			const yml = `version: 1.2.0
files:
  - url: SkySEO-1.2.0-x64.exe
    sha512: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
    size: 150000000
  - url: SkySEO-1.2.0-ia32.exe
    sha512: abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
    size: 150000000
path: SkySEO-1.2.0-x64.exe
sha512: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
releaseDate: '${new Date().toISOString()}'`

			res.setHeader('Content-Type', 'text/yaml')
			return res.send(yml)
		}

		res.setHeader('Content-Type', 'text/yaml')
		const fileStream = fs.createReadStream(ymlPath)
		fileStream.pipe(res)
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
