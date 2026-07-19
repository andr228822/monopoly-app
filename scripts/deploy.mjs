// Деплой на VPS одной командой: npm run deploy
// По аналогии с pokerface/scripts/deploy.mjs — свой путь на сервере и свой домен.
//
// Переопределяется через env: MP_VPS (user@host), MP_SSH_KEY (путь к ключу).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";

const HOST = process.env.MP_VPS || "root@5.129.201.114";
const HOME = process.env.USERPROFILE || process.env.HOME || "";
const SSH_KEY = process.env.MP_SSH_KEY || `${HOME}/.ssh/pf_deploy_key`;
const DOMAIN = process.env.MP_DOMAIN || "landgrab-app.duckdns.org";
const SSH_OPTS = [
  "-i", SSH_KEY,
  "-o", "UserKnownHostsFile=/dev/null",
  "-o", "StrictHostKeyChecking=no",
  "-o", "IdentitiesOnly=yes",
  "-o", "ConnectTimeout=25",
];
const TAR = ".monopoly-deploy.tgz";

const step = (n, msg) => console.log(`\n[${n}/4] ${msg}`);
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (r.status !== 0) {
    console.error(`\n✖ упало: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
  return r;
}

step(1, "Собираю веб…");
run("npm", ["run", "build:web"], { shell: true });

step(2, "Пакую билд…");
execFileSync("tar", ["-czf", TAR, "-C", "server/game/public", "."]);
const tarBuf = readFileSync(TAR);
console.log(`  архив: ${(tarBuf.length / 1024).toFixed(0)} КБ`);

step(3, "Заливаю на VPS…");
const up = spawnSync("ssh", [...SSH_OPTS, HOST, "cat > /tmp/monopoly-deploy.tgz"], { input: tarBuf });
if (up.status !== 0) {
  console.error("✖ не смог залить архив:", up.stderr?.toString().slice(0, 300));
  process.exit(1);
}
try { unlinkSync(TAR); } catch {}

step(4, "Обновляю код и перезапускаю сервер…");
const remote = `
set -e
cd /opt/monopoly
git fetch --quiet origin && git reset --hard --quiet origin/main
echo "  код: $(git rev-parse --short HEAD)"

if ! git diff --quiet HEAD@{1} HEAD -- package-lock.json server/game/package.json packages/shared/package.json 2>/dev/null; then
  echo "  зависимости изменились — переустанавливаю"
  docker run --rm -v /opt/monopoly:/app -w /app node:20-alpine \
    npm install --omit=dev --workspace=@monopoly/game-server --ignore-scripts >/dev/null 2>&1
fi

rm -rf server/game/public && mkdir -p server/game/public
tar -xzf /tmp/monopoly-deploy.tgz -C server/game/public
rm -f /tmp/monopoly-deploy.tgz
echo "  веб: $(cat server/game/public/version.json)"

cd /opt/livekit && docker compose up -d monopoly >/dev/null 2>&1
sleep 4
docker compose ps --format '{{.Name}} {{.Status}}' | grep monopoly
`;
run("ssh", [...SSH_OPTS, HOST, "bash -s"], { input: remote, stdio: ["pipe", "inherit", "inherit"] });

const check = spawnSync("curl", ["-s", "-m", "20", `https://${DOMAIN}/version.json`], { encoding: "utf8" });
console.log(`\n✓ Готово. Сервер отдаёт: ${(check.stdout || "").trim() || "(не смог проверить)"}`);
console.log(`  https://${DOMAIN}`);
