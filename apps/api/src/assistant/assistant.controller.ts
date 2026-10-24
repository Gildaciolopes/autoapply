import { Body, Controller, Get, Put } from '@nestjs/common';
import { AssistantSettingsBody, type AssistantSettings } from '@autoapply/shared';
import { ZodPipe } from '../kb/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

export function mcpUrl(env = process.env): string {
  return `http://127.0.0.1:${env.API_PORT ?? 3001}/mcp`;
}

/** F7: assistant (MCP) settings — approval from the assistant is off by default (FR-024). */
@Controller('assistant/settings')
export class AssistantController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(): Promise<AssistantSettings> {
    const p = await this.prisma.client.searchPreference.findUnique({ where: { id: 'default' }, select: { mcpApproveEnabled: true } });
    return { approveEnabled: p?.mcpApproveEnabled ?? false, url: mcpUrl() };
  }

  @Put()
  async put(@Body(new ZodPipe(AssistantSettingsBody)) body: AssistantSettingsBody): Promise<AssistantSettings> {
    await this.prisma.client.searchPreference.upsert({ where: { id: 'default' }, create: { id: 'default', mcpApproveEnabled: body.approveEnabled }, update: { mcpApproveEnabled: body.approveEnabled } });
    return this.get();
  }
}
