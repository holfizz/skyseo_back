import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { UpdatesController } from './updates.controller'

@Module({
	imports: [PrismaModule],
	controllers: [UpdatesController],
})
export class UpdatesModule {}
