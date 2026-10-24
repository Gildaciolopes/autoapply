import { randomUUID } from 'node:crypto';
import { All, Controller, Logger, Req, Res, type OnModuleDestroy } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { ApplyService } from '../apply/apply.service.js';
import { ControlService } from '../control/control.service.js';
import { FeedService } from '../jobs/feed.service.js';
import { NightService } from '../night/night.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReviewService } from '../review/review.service.js';
import { buildMcpServer } from './server.js';

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Same machine only (FR-019): loopback peer, loopback Host (DNS rebinding), and no foreign Origin. */
export function isLocalRequest(req: Pick<Request, 'headers'> & { socket: { remoteAddress?: string } }, webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000'): boolean {
  if (!LOOPBACK_IPS.has(req.socket.remoteAddress ?? '')) return false;
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (origin !== webOrigin && !LOOPBACK_HOSTS.has(o.hostname === '::1' ? '[::1]' : o.hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** F7 MCP endpoint (Streamable HTTP, stateful sessions) — contracts/mcp-tools.md. */
@Controller('mcp')
export class McpController implements OnModuleDestroy {
  private readonly logger = new Logger('mcp');
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: FeedService,
    private readonly apply: ApplyService,
    private readonly review: ReviewService,
    private readonly night: NightService,
    private readonly control: ControlService,
    private readonly analytics: AnalyticsService,
  ) {}

  async onModuleDestroy() {
    for (const t of this.transports.values()) await t.close().catch(() => undefined);
    this.transports.clear();
  }

  @All()
  async handle(@Req() req: Request, @Res() res: Response) {
    if (!isLocalRequest(req)) {
      res.status(403).json({ error: { code: 'not_local', message: 'o servidor MCP só aceita conexões desta máquina' } });
      return;
    }
    const sid = req.headers['mcp-session-id'];
    const existing = typeof sid === 'string' ? this.transports.get(sid) : undefined;
    if (existing) {
      await existing.handleRequest(req, res, req.body);
      return;
    }
    if (req.method !== 'POST' || sid || !isInitializeRequest(req.body)) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'sessão MCP inválida ou ausente' }, id: null });
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.transports.set(id, transport);
      },
      onsessionclosed: (id) => {
        this.transports.delete(id);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) this.transports.delete(transport.sessionId);
    };
    const server = buildMcpServer({ db: this.prisma.client, feed: this.feed, apply: this.apply, review: this.review, night: this.night, control: this.control, analytics: this.analytics });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
