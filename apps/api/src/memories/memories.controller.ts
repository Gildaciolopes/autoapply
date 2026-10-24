import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Query } from '@nestjs/common';
import { MemoryPatchBody } from '@autoapply/shared';
import { ZodPipe } from '../kb/zod.pipe.js';
import { MemoriesService } from './memories.service.js';

@Controller('memories')
export class MemoriesController {
  constructor(private readonly memories: MemoriesService) {}

  @Get()
  list(@Query('q') q?: string, @Query('enabled') enabled?: string) {
    return this.memories.list(q, enabled === undefined ? undefined : enabled === 'true');
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body(new ZodPipe(MemoryPatchBody)) body: MemoryPatchBody) {
    return this.memories.patch(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.memories.remove(id);
  }
}
