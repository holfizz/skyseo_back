import { Controller, Get, Param, Res } from '@nestjs/common'
import { Response } from 'express'

@Controller('updates')
export class UpdatesDevController {
	@Get('check/:platform/:currentVersion')
	async checkForUpdates(
		@Param('platform') platformString: string,
		@Param('currentVersion') currentVersion: string,
	) {
		// Простая проверка без БД для тестирования
		const testVersion = '1.2.0'
		const needsUpdate = this.compareVersions(currentVersion, testVersion) < 0

		if (!needsUpdate) {
			return {
				updateAvailable: false,
				currentVersion,
				latestVersion: testVersion,
			}
		}

		return {
			updateAvailable: true,
			currentVersion,
			latestVersion: testVersion,
			downloadUrl: 'https://s3.cloud.ru/skyseo/SkySEO-1.2.0-mac-arm64.zip',
			releaseNotes: [
				'Улучшена стабильность работы',
				'Исправлены ошибки обновлений',
				'Добавлены новые функции',
			],
			mandatory: false,
		}
	}

	@Get('latest')
	async getLatestVersion() {
		// Простой ответ без БД
		return {
			versions: [
				{
					platform: 'DARWIN_ARM64',
					version: '1.2.0',
					downloadUrl: 'https://s3.cloud.ru/skyseo/SkySEO-1.2.0-mac-arm64.zip',
					releaseNotes: [
						'Улучшена стабильность работы',
						'Исправлены ошибки обновлений',
						'Добавлены новые функции',
					],
					mandatory: false,
				},
				{
					platform: 'DARWIN_X64',
					version: '1.2.0',
					downloadUrl: 'https://s3.cloud.ru/skyseo/SkySEO-1.2.0-mac-x64.zip',
					releaseNotes: [
						'Улучшена стабильность работы',
						'Исправлены ошибки обновлений',
						'Добавлены новые функции',
					],
					mandatory: false,
				},
			],
		}
	}

	@Get('latest-mac.yml')
	async getLatestMacYml(@Res() res: Response) {
		const yml = `version: 1.2.0
files:
  - url: http://localhost:4000/v1/api/updates/download/SkySEO-1.2.0-mac-arm64.zip
    sha512: d2RcKUIOlPSrxPT0veA1hzEJWL3e7aD2qJ5Nz2jnhV+DXyevLwZ2dAwq1BqkLetCwvE/98m5S9Z07luhGQvCNQ==
    size: 97432887
  - url: http://localhost:4000/v1/api/updates/download/SkySEO-1.2.0-mac-x64.zip
    sha512: obBD/64JqeXRUvTF17IaOqxi9sToL5A6u4pIcvZuacoFSLY/3EtEToo3QVa13ixhmLW2AfnNBVBkGE347Bau6w==
    size: 97432887
path: http://localhost:4000/v1/api/updates/download/SkySEO-1.2.0-mac-arm64.zip
sha512: d2RcKUIOlPSrxPT0veA1hzEJWL3e7aD2qJ5Nz2jnhV+DXyevLwZ2dAwq1BqkLetCwvE/98m5S9Z07luhGQvCNQ==
releaseDate: '2026-04-18T14:00:00.000Z'`

		res.setHeader('Content-Type', 'text/yaml')
		res.send(yml)
	}

	@Get('latest.yml')
	async getLatestYml(@Res() res: Response) {
		const yml = `version: 1.2.0
files:
  - url: https://s3.cloud.ru/skyseo/SkySEO-1.2.0-x64.exe
    sha512: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
    size: 150000000
  - url: https://s3.cloud.ru/skyseo/SkySEO-1.2.0-ia32.exe
    sha512: abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
    size: 150000000
path: https://s3.cloud.ru/skyseo/SkySEO-1.2.0-x64.exe
sha512: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
releaseDate: '2026-04-18T10:00:00.000Z'`

		res.setHeader('Content-Type', 'text/yaml')
		res.send(yml)
	}

	@Get('download/:filename')
	async downloadFile(
		@Param('filename') filename: string,
		@Res() res: Response,
	) {
		// Для тестирования возвращаем существующий ZIP файл
		const filePath = `/Users/holfizz/Developer/skyseo/skyseo_app/release/${filename}`

		try {
			// Проверяем существование файла
			const fs = require('fs')
			if (!fs.existsSync(filePath)) {
				return res.status(404).json({ error: 'File not found' })
			}

			// Отправляем файл
			res.download(filePath, filename)
		} catch (error) {
			console.error('Download error:', error)
			res.status(500).json({ error: 'Download failed' })
		}
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
