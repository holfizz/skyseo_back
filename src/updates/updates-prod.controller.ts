import { Controller, Get, Res } from '@nestjs/common'
import { Platform } from '@prisma/client'
import { Response } from 'express'
import { PrismaService } from '../prisma/prisma.service'

@Controller('updates')
export class UpdatesProdController {
	constructor(private prisma: PrismaService) {}

	@Get('latest')
	async getLatestVersion() {
		const versions = await this.prisma.appVersion.findMany({
			where: { isActive: true },
			orderBy: { createdAt: 'desc' },
			take: 4,
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

	@Get('latest-mac.yml')
	async getLatestMacYml(@Res() res: Response) {
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

		const mainVersion = arm64Version || x64Version

		const yml = `version: ${mainVersion.version}
files:
  - url: ${arm64Version?.downloadUrl || ''}
    sha512: ${arm64Version?.sha512 || ''}
    size: ${arm64Version?.fileSize || 0}
  - url: ${x64Version?.downloadUrl || ''}
    sha512: ${x64Version?.sha512 || ''}
    size: ${x64Version?.fileSize || 0}
path: ${arm64Version?.downloadUrl || x64Version?.downloadUrl || ''}
sha512: ${arm64Version?.sha512 || x64Version?.sha512 || ''}
releaseDate: '${mainVersion.createdAt.toISOString()}'`

		res.setHeader('Content-Type', 'text/yaml')
		res.send(yml)
	}

	@Get('latest.yml')
	async getLatestYml(@Res() res: Response) {
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

		const mainVersion = x64Version || ia32Version

		const yml = `version: ${mainVersion.version}
files:
  - url: ${x64Version?.downloadUrl || ''}
    sha512: ${x64Version?.sha512 || ''}
    size: ${x64Version?.fileSize || 0}
  - url: ${ia32Version?.downloadUrl || ''}
    sha512: ${ia32Version?.sha512 || ''}
    size: ${ia32Version?.fileSize || 0}
path: ${x64Version?.downloadUrl || ia32Version?.downloadUrl || ''}
sha512: ${x64Version?.sha512 || ia32Version?.sha512 || ''}
releaseDate: '${mainVersion.createdAt.toISOString()}'`

		res.setHeader('Content-Type', 'text/yaml')
		res.send(yml)
	}
}
