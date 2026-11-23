// Client Telegram. Il token è nell'URL: ogni errore passa da redact(). Non lancia mai: chi chiama non si ferma.
import * as fs from "node:fs";
import * as path from "node:path";
import { TELEGRAM_URL } from "../config/costanti.ts";
import { httpJson, HttpError, type FetchFn } from "../util/http.ts";
import { errText, redact } from "../util/redact.ts";
import type { Logger } from "../util/log.ts";
import { splitMessage } from "./format.ts";
import type { Bottone, CallbackQuery, Telegram } from "./types.ts";

export class TelegramClient implements Telegram {
  readonly name = "telegram" as const;
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly log: Logger,
    private readonly fetchFn: FetchFn = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async call<T = any>(method: string, body: unknown, timeoutMs = 20_000): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await httpJson<any>(this.fetchFn, `${TELEGRAM_URL}/bot${this.token}/${method}`, { method: "POST", body, timeoutMs });
        return r.data.result as T;
      } catch (e) {
        if (e instanceof HttpError && e.status === 429 && attempt < 2) {
          const ra = Number((e.body as any)?.parameters?.retry_after ?? 5);
          await this.sleep(Math.min(Math.max(ra, 1), 120) * 1000);
          continue;
        }
        throw new Error(redact(errText(e)));
      }
    }
  }

  async send(html: string, opts: { bottoni?: Bottone[][] } = {}): Promise<{ ok: boolean; errore?: string }> {
    const parts = splitMessage(html);
    try {
      for (let i = 0; i < parts.length; i++) {
        const last = i === parts.length - 1;
        await this.call("sendMessage", {
          chat_id: this.chatId,
          text: parts[i],
          parse_mode: "HTML",
          disable_web_page_preview: true,
          ...(last && opts.bottoni ? { reply_markup: { inline_keyboard: opts.bottoni } } : {}),
        });
      }
      return { ok: true };
    } catch (e) {
      const errore = errText(e);
      this.log.warn("telegram non raggiungibile", { errore });
      return { ok: false, errore };
    }
  }

  async getUpdates(offset: number): Promise<{ updates: { updateId: number; callback: CallbackQuery | null }[]; errore?: string }> {
    try {
      const res = await this.call<any[]>("getUpdates", { offset, timeout: 0, allowed_updates: ["callback_query", "message"] }, 30_000);
      return {
        updates: (res ?? []).map((u) => ({
          updateId: Number(u.update_id),
          callback: u.callback_query
            ? {
                id: String(u.callback_query.id),
                data: String(u.callback_query.data ?? ""),
                chatId: u.callback_query.message?.chat?.id != null ? String(u.callback_query.message.chat.id) : null,
                messageId: u.callback_query.message?.message_id ?? null,
                from: u.callback_query.from?.id != null ? String(u.callback_query.from.id) : null,
              }
            : null,
        })),
      };
    } catch (e) {
      return { updates: [], errore: errText(e) };
    }
  }

  async answerCallback(id: string, text: string): Promise<void> {
    try {
      await this.call("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 190) });
    } catch (e) {
      this.log.warn("answerCallbackQuery fallita", { errore: errText(e) });
    }
  }
}

/** Telegram finto per --fake: scrive i messaggi in un file di log. */
export class FakeTelegram implements Telegram {
  readonly name = "finto" as const;
  readonly sent: { html: string; bottoni?: Bottone[][] }[] = [];
  queue: { updateId: number; callback: CallbackQuery | null }[] = [];
  answers: { id: string; text: string }[] = [];
  down = false;
  constructor(private readonly file: string | null = null) {}
  async send(html: string, opts: { bottoni?: Bottone[][] } = {}) {
    if (this.down) return { ok: false, errore: "Telegram non raggiungibile (finto)" };
    for (const p of splitMessage(html)) this.sent.push({ html: p, bottoni: opts.bottoni });
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `\n----- ${new Date().toISOString()}\n${redact(html)}\n${opts.bottoni ? JSON.stringify(opts.bottoni) + "\n" : ""}`);
    }
    return { ok: true };
  }
  async getUpdates(offset: number) {
    return { updates: this.queue.filter((u) => u.updateId >= offset) };
  }
  async answerCallback(id: string, text: string) {
    this.answers.push({ id, text });
  }
}
