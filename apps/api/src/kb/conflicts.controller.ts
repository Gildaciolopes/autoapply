import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ResolveConflictBody } from '@autoapply/shared';
import { ConflictsService } from './conflicts.service.js';
import { ZodPipe } from './zod.pipe.js';

@Controller('kb/conflicts')
export class ConflictsController {
  constructor(private readonly conflicts: ConflictsService) {}

  @Get()
  list(@Query('status') status?: 'open' | 'resolved') {
    return this.conflicts.list(status === 'resolved' ? 'resolved' : 'open');
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Body(new ZodPipe(ResolveConflictBody)) body: ResolveConflictBody) {
    return this.conflicts.resolve(id, body);
  }
}
