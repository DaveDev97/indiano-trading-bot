// fetch con timeout e classificazione degli errori. I messaggi passano sempre da redact().
import { errText, redact } from "./redact.ts";

export type HttpErrorKind = "timeout" | "rete" | "http";

export class HttpError extends Error {
  constructor(
    readonly kind: HttpErrorKind,
    readonly status: number | null,
    message: string,
    readonly body: unknown = null,
  ) {
    super(redact(message));
    this.name = "HttpError";
  }
}

export interface HttpOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export async function httpJson<T = any>(fetchFn: FetchFn, url: string, opts: HttpOpts = {}): Promise<{ status: number; data: T }> {
  const ctrl = new AbortController();
  const timeout = opts.timeoutMs ?? 20_000;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: opts.method ?? "GET",
      headers: { Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (ctrl.signal.aborted || e?.name === "AbortError" || e?.name === "TimeoutError")
      throw new HttpError("timeout", null, `timeout dopo ${timeout} ms: ${safeUrl(url)}`);
    throw new HttpError("rete", null, `errore di rete su ${safeUrl(url)}: ${errText(e)}`);
  }
  let text = "";
  try {
    text = await res.text();
  } catch (e) {
    clearTimeout(timer);
    if (ctrl.signal.aborted) throw new HttpError("timeout", null, `timeout dopo ${timeout} ms: ${safeUrl(url)}`);
    throw new HttpError("rete", null, `risposta interrotta da ${safeUrl(url)}: ${errText(e)}`);
  }
  clearTimeout(timer);
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = typeof data === "object" && data && "message" in data ? String((data as any).message) : String(text).slice(0, 300);
    throw new HttpError("http", res.status, `HTTP ${res.status} da ${safeUrl(url)}: ${msg}`, data);
  }
  return { status: res.status, data: data as T };
}

/** URL senza querystring e senza token nel percorso, per i messaggi. */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return redact(`${u.origin}${u.pathname}`);
  } catch {
    return "[url]";
  }
}
