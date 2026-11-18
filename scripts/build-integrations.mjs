import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "public/integrations");
mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, "ghostchat-wordpress.zip");
const pluginDir = path.join(root, "integrations/wordpress/ghostchat");
execFileSync("python3", ["-m", "zipfile", "-c", zip, "ghostchat"], { cwd: path.join(root, "integrations/wordpress") });
copyFileSync(path.join(root, "integrations/shopify/snippets/ghostchat.liquid"), path.join(outDir, "ghostchat.liquid"));
if (!existsSync(zip)) throw new Error("WordPress zip was not created");
console.log("integrations: wordpress zip + shopify snippet");
