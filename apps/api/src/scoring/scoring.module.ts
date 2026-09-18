import { Global, Module } from '@nestjs/common';
import { ScoringClient } from './scoring.client';

@Global()
@Module({
  providers: [ScoringClient],
  exports: [ScoringClient],
})
export class ScoringModule {}
