// Modello di secrets.ts con i campi vuoti. Copialo in secrets.ts e compila i valori.
// Questo file si può condividere: non contiene segreti.

export interface Secrets {
  alpaca: {
    /** Key ID del conto PAPER. Inizia con "PK". Se inizia con "AK" è una chiave live: il bot si rifiuta di partire. */
    keyId: string;
    /** Secret key del conto PAPER. */
    secretKey: string;
  };
  telegram: {
    /** Token del bot, quello che ti ha dato BotFather (formato 123456789:ABC...). */
    botToken: string;
    /**
     * Id della tua chat con il bot. Come ricavarlo:
     * 1. scrivi /start al tuo bot su Telegram;
     * 2. apri nel browser https://api.telegram.org/bot<TOKEN>/getUpdates (con il tuo token al posto di <TOKEN>);
     * 3. copia il numero in "chat":{"id": ... }.
     * È anche l'unica chat da cui il bot accetta i pulsanti Approva/Rifiuta.
     */
    chatId: string;
  };
  finnhub: {
    /** Chiave API gratuita da https://finnhub.io (Dashboard → API key). */
    apiKey: string;
  };
  dashboard: {
    /** Password per entrare nella dashboard web (http://127.0.0.1:8787). Almeno 12 caratteri. */
    password: string;
  };
  claude: {
    /**
     * Facoltativo. Token per il "cervello" (claude -p), generato con `claude setup-token`.
     * Se lo lasci vuoto, il bot usa la variabile d'ambiente CLAUDE_CODE_OAUTH_TOKEN.
     * Compilarlo qui è più affidabile quando il bot parte dall'Utilità di pianificazione.
     */
    oauthToken: string;
  };
}

export const secrets: Secrets = {
  alpaca: {
    keyId: "",
    secretKey: "",
  },
  telegram: {
    botToken: "",
    chatId: "",
  },
  finnhub: {
    apiKey: "",
  },
  dashboard: {
    password: "",
  },
  claude: {
    oauthToken: "",
  },
};
