// Lettore unico degli aggiornamenti di Telegram (§7.3): lo usa SOLO il processo della dashboard, ogni 30 secondi.
// Accetta solo i pulsanti della chat autorizzata. L'offset si salva, così un clic non si rilegge.
import type { Ctx } from "../run/context.ts";
import { readJsonOr, writeJsonAtomic } from "../util/atomic.ts";
import { decidiProposta } from "../learning/review.ts";
import { esc } from "./format.ts";

export async function leggiPulsanti(ctx: Ctx): Promise<{ letti: number; ignorati: number; errore?: string }> {
  const st = readJsonOr<{ offset: number }>(ctx.paths.telegramOffset, { offset: 0 });
  const r = await ctx.tg.getUpdates(st.offset);
  if (r.errore) return { letti: 0, ignorati: 0, errore: r.errore };
  let letti = 0, ignorati = 0, offset = st.offset;
  for (const u of r.updates) {
    offset = Math.max(offset, u.updateId + 1);
    const cb = u.callback;
    if (!cb) continue;
    if (!ctx.chatId || cb.chatId !== String(ctx.chatId)) {
      ignorati++;
      ctx.log.warn("pulsante da una chat non autorizzata: ignorato", { chat: cb.chatId });
      continue;
    }
    const m = /^rv:([ar]):(.+)$/.exec(cb.data);
    if (!m) {
      await ctx.tg.answerCallback(cb.id, "Comando non riconosciuto");
      continue;
    }
    const esito = decidiProposta(ctx, m[2]!, m[1] === "a", "telegram");
    letti++;
    await ctx.tg.answerCallback(cb.id, esito.messaggio);
    await ctx.tg.send(`${esito.ok ? "✅" : "ℹ"} Proposta <code>${esc(m[2])}</code>: ${esc(esito.messaggio)}`);
  }
  if (offset !== st.offset) writeJsonAtomic(ctx.paths.telegramOffset, { offset });
  return { letti, ignorati };
}
