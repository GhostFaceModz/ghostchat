import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "widget", "widget.js");
const out = path.join(root, "widget", "widget.min.js");
await build({
  entryPoints: [src],
  outfile: out,
  bundle: false,
  minify: true,
  legalComments: "none",
  logLevel: "info",
});
const hash = createHash("sha256").update(readFileSync(out)).digest("hex").slice(0, 10);
writeFileSync(path.join(root, "widget", "version.txt"), hash + "\n");
console.log(`widget.min.js ${hash}`);
