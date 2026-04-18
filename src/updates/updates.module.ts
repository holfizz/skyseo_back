import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { UpdatesProdController } from './updates-prod.controller'

@Module({
	imports: [PrismaModule],
	controllers: [UpdatesProdController],
})
export class UpdatesModule {}
