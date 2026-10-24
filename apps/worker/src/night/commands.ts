import { getTelegramUpdates, nightWindow, parseTelegramCommand, sendTelegramMessage, type TelegramCommand, type TelegramConfig } from '@autoapply/jobs';
import { loadNightSettings, resumeEverything, stopEverything, updateNightRow, type PrismaClient } from '@autoapply/db';

/** F6 FR-019: `parar` / `retomar` / `status` from the configured chat only; everything else ignored. */

export interface CommandDeps {
  db: PrismaClient;
  config: TelegramConfig;
  fetchImpl?: typeof fetch;
  /** Removes not-started jobs from the work queues (discover, jobspy, tailor, apply). */
  drainQueues: () => Promise<number>;
  enqueueReport: (nightRunId: string) => Promise<void>;
  timeoutSec?: number;
}

const fmt = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(d);

export async function statusText(db: PrismaClient, now = new Date()): Promise<string> {
  const s = await loadNightSettings(db);
  const running = await db.nightRun.findFirst({ where: { status: 'running' } });
  const lines = ['AutoApply — status'];
  lines.push(s.pausedAt ? `⏸ Pausado desde ${fmt(s.pausedAt)}` : '▶️ Ativo');
  if (running) lines.push(`Execução em andamento (fase: ${running.phase})`);
  if (s.enabled) {
    const w = nightWindow(now, s);
    const next = w.current ?? w.next;
    if (next) lines.push(`${w.current ? 'Janela atual' : 'Próxima noite'}: ${fmt(next.start)} → ${fmt(next.end)}`);
  } else lines.push('Execução noturna desligada');
  const ready = await db.application.count({ where: { status: 'ready' } });
  lines.push(`Prontas para revisar: ${ready}`);
  return lines.join('\n');
}

async function act(d: CommandDeps, cmd: TelegramCommand): Promise<string> {
  if (cmd === 'stop') {
    const r = await stopEverything(d.db, { removeJobs: d.drainQueues });
    if (r.runStopped) await d.enqueueReport(r.runStopped);
    return `⏹ Parado. ${r.cancelled} item(ns) cancelado(s). Nada será enviado nem agendado até você enviar "retomar".`;
  }
  if (cmd === 'resume') {
    await resumeEverything(d.db);
    return '▶️ Retomado: o agendamento volta na próxima janela. Itens parados não recomeçam sozinhos.';
  }
  return statusText(d.db);
}

/** One long-poll round: process every update, advance the stored offset past each one. */
export async function pollTelegram(d: CommandDeps): Promise<{ updates: number; commands: TelegramCommand[] }> {
  const s = await loadNightSettings(d.db);
  const updates = await getTelegramUpdates(d.config, s.telegramOffset, d.fetchImpl ?? fetch, d.timeoutSec ?? 20);
  const commands: TelegramCommand[] = [];
  for (const u of updates) {
    await updateNightRow(d.db, { telegramOffset: u.update_id + 1 });
    const cmd = parseTelegramCommand(u, d.config.chatId);
    if (!cmd) continue;
    commands.push(cmd);
    const reply = await act(d, cmd);
    await sendTelegramMessage(d.config, reply, d.fetchImpl ?? fetch).catch(() => undefined);
  }
  return { updates: updates.length, commands };
}
