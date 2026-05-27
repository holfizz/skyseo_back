import { Module } from '@nestjs/common'
import { MetrikaService } from './metrika.service'

@Module({
	providers: [MetrikaService],
	exports: [MetrikaService],
})
export class MetrikaModule {}
