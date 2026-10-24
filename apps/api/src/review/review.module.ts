import { Module } from '@nestjs/common';
import { ApplyModule } from '../apply/apply.module.js';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';

@Module({ imports: [ApplyModule], controllers: [ReviewController], providers: [ReviewService] })
export class ReviewModule {}
