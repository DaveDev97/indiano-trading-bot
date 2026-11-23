// bun run build [--senza-test] — crea i pacchetti scaricabili in build/:
//   indiano-trading-<versione>-windows.zip    (start.ps1, start.cmd, pianificazione per l'Utilità di pianificazione)
//   indiano-trading-<versione>-linux.tar.gz   (start.sh, pianificazione con i timer di systemd; es. Raspberry Pi 4B)
//   SHA256SUMS.txt
// Il motore è lo stesso nei due pacchetti. Non entrano mai: secrets.ts, state/, logs/, cache/, fake/, build/.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { creaTarGz, creaZip, type VoceArchivio } from "../src/util/archivi.ts";

const RADICE = path.resolve(import.meta.dir, "..");
const args = new Set(process.argv.slice(2));
const pkg = JSON.parse(fs.readFileSync(path.join(RADICE, "package.json"), "utf8"));
const versione: string = pkg.version ?? "0.0.0";
const cartella = `indiano-trading-${versione}`;

const CARTELLE = ["src", "tests", "docs", "scripts"];
const FILE = ["package.json", "tsconfig.json", "secrets.example.ts", "README.md", "Contratto.md", "CLAUDE.md"];
const VIETATI = [/(^|\/)secrets\.ts$/, /^(state|logs|cache|fake|build|node_modules|\.git)\//, /\.env/, /\.tmp-/];
const SOLO_WINDOWS = [/\.ps1$/, /\.cmd$/];
const SOLO_LINUX = [/\.sh$/];

function elenca(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(RADICE, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...elenca(rel));
    else out.push(rel);
  }
  return out;
}

const tutti = [...CARTELLE.flatMap(elenca), ...FILE.filter((f) => fs.existsSync(path.join(RADICE, f)))];
for (const f of tutti) if (VIETATI.some((r) => r.test(f))) throw new Error(`build interrotta: il file ${f} non deve finire in un pacchetto`);

function voci(sistema: "windows" | "linux"): VoceArchivio[] {
  const extra = sistema === "windows" ? ["start.ps1", "start.cmd"] : ["start.sh"];
  const lista = [...tutti, ...extra].filter((f) => !(sistema === "windows" ? SOLO_LINUX : SOLO_WINDOWS).some((r) => r.test(f)));
  return lista.sort().map((f) => {
    let dati: Uint8Array = fs.readFileSync(path.join(RADICE, f));
    if (f.endsWith(".sh")) dati = new TextEncoder().encode(new TextDecoder().decode(dati).replace(/\r\n/g, "\n")); // bash vuole LF
    return { nome: `${cartella}/${f}`, dati, modo: f.endsWith(".sh") ? 0o755 : 0o644, mtime: fs.statSync(path.join(RADICE, f)).mtime };
  });
}

if (!args.has("--senza-test")) {
  console.log("Eseguo bun test prima di creare i pacchetti…");
  const t = Bun.spawnSync([process.execPath, "test"], { cwd: RADICE, stdout: "inherit", stderr: "inherit" });
  if (t.exitCode !== 0) {
    console.error("Test falliti: nessun pacchetto creato.");
    process.exit(1);
  }
}

const out = path.join(RADICE, "build");
fs.mkdirSync(out, { recursive: true });
const win = path.join(out, `${cartella}-windows.zip`);
const lin = path.join(out, `${cartella}-linux.tar.gz`);
const vw = voci("windows"), vl = voci("linux");
fs.writeFileSync(win, creaZip(vw));
fs.writeFileSync(lin, creaTarGz(vl));
const sha = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
fs.writeFileSync(path.join(out, "SHA256SUMS.txt"), [win, lin].map((f) => `${sha(f)}  ${path.basename(f)}`).join("\n") + "\n");
const kb = (f: string) => `${Math.round(fs.statSync(f).size / 1024)} KB`;
console.log(`Creati in build/:\n  ${path.basename(win)} (${vw.length} file, ${kb(win)})\n  ${path.basename(lin)} (${vl.length} file, ${kb(lin)})\n  SHA256SUMS.txt`);
