// Штампует версию (git SHA) в /version.json собранного веба — источник правды
// «что сейчас на сервере» для проверки деплоя.
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const OUT = "../../server/game/public";

let version;
try {
  version = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  version = Date.now().toString(36);
}

writeFileSync(`${OUT}/version.json`, JSON.stringify({ version, builtAt: new Date().toISOString() }));
console.log(`stamp-version: ${version}`);
