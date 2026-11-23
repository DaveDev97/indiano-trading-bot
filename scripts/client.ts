// bun run client — compila il lato browser della dashboard (grafici bklit + motion) in src/dashboard/assets/:
//   client.js  (React, motion, d3 e i componenti bklit, in un solo file minificato)
//   client.css (classi Tailwind usate dai componenti, senza reset di base)
// I due file stanno nel repository: dashboard e pacchetti funzionano senza node_modules (es. sul Raspberry).
import * as path from "node:path";
import * as fs from "node:fs";

const RADICE = path.resolve(import.meta.dir, "..");
const OUT = path.join(RADICE, "src", "dashboard", "assets");
const r = await Bun.build({
  entrypoints: [path.join(RADICE, "src", "dashboard", "client", "main.tsx")],
  target: "browser",
  minify: true,
  format: "esm",
  define: { "process.env.NODE_ENV": '"production"' },
  tsconfig: path.join(RADICE, "tsconfig.json"),
});
if (!r.success) {
  for (const m of r.logs) console.error(m);
  process.exit(1);
}
const js = await r.outputs[0]!.text();
fs.writeFileSync(path.join(OUT, "client.js"), `/* Dashboard Indiano Trading: grafici bklit (MIT, src/dashboard/client/bklit/LICENSE), React, motion, d3. Generato da bun run client. */\n${js}`);
const tw = Bun.spawnSync([process.execPath, "x", "@tailwindcss/cli", "-i", path.join(RADICE, "src", "dashboard", "client", "tema.css"), "-o", path.join(OUT, "client.css"), "--minify"], { cwd: RADICE, stdout: "inherit", stderr: "inherit" });
if (tw.exitCode !== 0) process.exit(tw.exitCode ?? 1);
const kb = (f: string) => `${Math.round(fs.statSync(path.join(OUT, f)).size / 1024)} KB`;
console.log(`client.js ${kb("client.js")}, client.css ${kb("client.css")}`);
