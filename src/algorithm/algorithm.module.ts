import { Module } from '@nestjs/common'
import { AppConfigModule } from '../app-config/app-config.module'
import { PrismaModule } from '../prisma/prisma.module'
import { AlgorithmController, AlgorithmAdminController } from './algorithm.controller'
import { AlgorithmService } from './algorithm.service'

@Module({
	imports: [AppConfigModule, PrismaModule],
	controllers: [AlgorithmController, AlgorithmAdminController],
	providers: [AlgorithmService],
})
export class AlgorithmModule {}
