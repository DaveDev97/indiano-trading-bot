// Argomenti della riga di comando: --flag e --nome valore.

export interface Args {
  flags: Set<string>;
  values: Map<string, string>;
  rest: string[];
}

export function parseArgs(argv: string[] = process.argv.slice(2)): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        values.set(a.slice(2, eq), a.slice(eq + 1));
        continue;
      }
      const name = a.slice(2);
      const next = argv[i + 1];
      if (VALUE_OPTIONS.has(name) && next !== undefined && !next.startsWith("--")) {
        values.set(name, next);
        i++;
      } else flags.add(name);
    } else rest.push(a);
  }
  return { flags, values, rest };
}

const VALUE_OPTIONS = new Set(["slot", "ora", "porta", "simboli", "limite"]);
