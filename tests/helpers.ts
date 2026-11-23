// Utilità comuni ai test: cartelle temporanee isolate.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makePaths, type Paths } from "../src/config/paths.ts";

export function tempRoot(name = "t"): Paths {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `indiano-${name}-`));
  return makePaths(dir);
}

export function rmRoot(p: Paths): void {
  try {
    fs.rmSync(p.root, { recursive: true, force: true });
  } catch {}
}
