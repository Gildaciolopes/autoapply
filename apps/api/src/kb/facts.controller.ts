import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import { BulkFactsBody, CreateFactBody, FactsQuery, PatchFactBody, PersonalFacts } from '@autoapply/shared';
import { FactsService } from './facts.service.js';
import { ZodPipe } from './zod.pipe.js';

@Controller('kb')
export class FactsController {
  constructor(private readonly facts: FactsService) {}

  @Get('facts')
  list(@Query(new ZodPipe(FactsQuery)) q: z.infer<typeof FactsQuery>) {
    return this.facts.list(q);
  }

  @Get('facts/:id')
  get(@Param('id') id: string) {
    return this.facts.get(id);
  }

  @Post('facts')
  create(@Body(new ZodPipe(CreateFactBody)) body: z.infer<typeof CreateFactBody>) {
    return this.facts.create(body.kind, body.value);
  }

  @Patch('facts/:id')
  patch(@Param('id') id: string, @Body(new ZodPipe(PatchFactBody)) body: z.infer<typeof PatchFactBody>) {
    return this.facts.patch(id, body);
  }

  @Post('facts/bulk')
  bulk(@Body(new ZodPipe(BulkFactsBody)) body: z.infer<typeof BulkFactsBody>) {
    return this.facts.bulk(body.ids, body.action);
  }

  @Get('personal')
  getPersonal() {
    return this.facts.getPersonal();
  }

  @Put('personal')
  putPersonal(@Body(new ZodPipe(PersonalFacts)) body: z.infer<typeof PersonalFacts>) {
    return this.facts.putPersonal(body);
  }
}
