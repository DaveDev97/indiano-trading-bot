// Interfaccia di Telegram (vero e finto).

export interface Bottone {
  text: string;
  callback_data: string;
}

export interface CallbackQuery {
  id: string;
  data: string;
  chatId: string | null;
  messageId: number | null;
  from: string | null;
}

export interface Telegram {
  readonly name: "telegram" | "finto";
  /** Invia un messaggio HTML (già formattato, già convertito). Spezza oltre 4096 caratteri. Non lancia mai. */
  send(html: string, opts?: { bottoni?: Bottone[][] }): Promise<{ ok: boolean; errore?: string }>;
  /** Solo il processo della dashboard la usa. */
  getUpdates(offset: number): Promise<{ updates: { updateId: number; callback: CallbackQuery | null }[]; errore?: string }>;
  answerCallback(id: string, text: string): Promise<void>;
}
