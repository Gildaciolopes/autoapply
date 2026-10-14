import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Thin client for stickerdaniel/linkedin-mcp-server (docker compose profile "linkedin").
 * Tools used: search_jobs, get_job_details, get_job_apply_url, get_my_profile.
 * Read-only usage here; submitting Easy Apply is done by Playwright in the apply step.
 */
@Injectable()
export class LinkedinMcpClient implements OnModuleDestroy {
  private readonly logger = new Logger(LinkedinMcpClient.name);
  private client?: Client;

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const url = new URL(process.env.LINKEDIN_MCP_URL ?? 'http://localhost:8765/mcp');
    const client = new Client({ name: 'autoapply-worker', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url));
    this.logger.log(`connected to ${url}`);
    this.client = client;
    return client;
  }

  async listTools(): Promise<string[]> {
    const { tools } = await (await this.connect()).listTools();
    return tools.map((t) => t.name);
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await (await this.connect()).callTool({ name, arguments: args });
    if (res.isError) throw new Error(`linkedin-mcp ${name} failed: ${JSON.stringify(res.content)}`);
    return res.structuredContent ?? res.content;
  }

  async onModuleDestroy() {
    await this.client?.close();
  }
}
