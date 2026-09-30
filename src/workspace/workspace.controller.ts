import { Body, Controller, Get, Param, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AdminGuard } from '../admin/admin.guard'
import { WorkspaceService } from './workspace.service'
import type { Response } from 'express'
@Controller('admin/workspace')
@UseGuards(JwtAuthGuard, AdminGuard)
export class WorkspaceController {
 constructor(private svc: WorkspaceService) {}
 @Get('dashboard') dashboard(@Query('days') days?: string) { return this.svc.dashboard(days ? Number(days) : 30) }
 @Get('settings') settings() { return this.svc.settings() }
 @Put('settings') saveSettings(@Body() b: any) { return this.svc.saveSettings(b) }
 @Get('clients') clients() { return this.svc.clients() }
 @Post('clients') create(@Body() b: any) { return this.svc.saveClient(null, b) }
 @Put('clients/:id') update(@Param('id') id: string, @Body() b: any) { return this.svc.saveClient(id, b) }
 @Put('clients/:id/months/:month') month(@Param('id') id: string, @Param('month') month: string, @Body() b: any) { return this.svc.month(id, month, b) }
 @Post('clients/:id/contracts')
 @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
 upload(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) { return this.svc.upload(id, file) }
 @Get('contracts/:id') async download(@Param('id') id: string, @Res() res: Response) {
  const f = await this.svc.contract(id)
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(f.data)
 }
}
