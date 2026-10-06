import { LearningLatexService } from './learning-latex.service';
import { Module } from '@nestjs/common';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';
@Module({ controllers: [LearningController], providers: [LearningService, LearningLatexService] })
export class LearningModule {}
