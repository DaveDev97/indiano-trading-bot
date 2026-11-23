// Tipologie di task del cervello (§8.7). Per aggiungerne una basta inserirla qui: la scheda Consumi la mostra da sola.

export const AI_TASKS = [
  { id: "decisione-briefing", nome: "Decisione briefing" },
  { id: "decisione-apertura", nome: "Decisione apertura" },
  { id: "decisione-meta", nome: "Decisione metà seduta" },
  { id: "decisione-chiusura", nome: "Decisione chiusura" },
  { id: "review", nome: "Review periodica" },
  { id: "probe", nome: "Sonda/prova" },
] as const;

export type AiTaskId = (typeof AI_TASKS)[number]["id"];

export function nomeTask(id: string): string {
  return AI_TASKS.find((t) => t.id === id)?.nome ?? id;
}

export type EsitoAi = "ok" | "timeout" | "risposta non valida" | "budget superato" | "errore";
export const ESITI_AI: EsitoAi[] = ["ok", "timeout", "risposta non valida", "budget superato", "errore"];
