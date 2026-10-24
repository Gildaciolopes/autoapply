/** F6 Telegram Bot API transport (fetch injected) + command parsing (pure). Research R6. */

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export function telegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

export class TelegramError extends Error {}

async function call<T>(cfg: TelegramConfig, method: string, body: Record<string, unknown>, fetchImpl: typeof fetch, timeoutMs = 35_000): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`https://api.telegram.org/bot${cfg.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Never echo the URL: it contains the bot token.
    throw new TelegramError(`Telegram indisponível (${(e as Error).name})`);
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!res.ok || !data.ok) throw new TelegramError(`Telegram recusou (${res.status}${data.description ? `: ${data.description}` : ''})`);
  return data.result as T;
}

/** Plain text only (no parse_mode): job titles cannot inject markup or links. */
export function sendTelegramMessage(cfg: TelegramConfig, text: string, fetchImpl: typeof fetch = fetch) {
  return call(cfg, 'sendMessage', { chat_id: cfg.chatId, text: text.slice(0, 4000), disable_web_page_preview: true }, fetchImpl, 15_000);
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat?: { id?: number | string }; text?: string };
}

export function getTelegramUpdates(cfg: TelegramConfig, offset: number, fetchImpl: typeof fetch = fetch, timeoutSec = 25) {
  return call<TelegramUpdate[]>(cfg, 'getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message'] }, fetchImpl, (timeoutSec + 10) * 1000);
}

export type TelegramCommand = 'stop' | 'resume' | 'status';

const COMMANDS: Record<string, TelegramCommand> = { parar: 'stop', stop: 'stop', retomar: 'resume', resume: 'resume', status: 'status' };

/** Only messages from the configured chat are commands; everything else is ignored (FR-019). */
export function parseTelegramCommand(update: TelegramUpdate, chatId: string): TelegramCommand | null {
  const from = update.message?.chat?.id;
  if (from === undefined || String(from) !== String(chatId)) return null;
  const word = (update.message?.text ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\//, '')
    .split(/[\s@]/)[0];
  return COMMANDS[word ?? ''] ?? null;
}
