import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(appDir, "fixtures", "playground");
const playgroundPath = path.join(appDir, ".dev-electron", "playground");

await fs.rm(playgroundPath, { force: true, recursive: true });
await fs.mkdir(path.dirname(playgroundPath), { recursive: true });
await fs.cp(fixturePath, playgroundPath, { recursive: true });

console.log(`Synced ${fixturePath} -> ${playgroundPath}`);
