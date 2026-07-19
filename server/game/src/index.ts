import "dotenv/config";
import http from "http";
import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { GameRoom } from "./rooms/GameRoom";

const port = Number(process.env.PORT) || 2567;

const app = express();
const httpServer = http.createServer(app);

app.use(cors());
app.use(express.json());

app.use("/monitor", monitor());

// Список публичных лобби.
app.get("/rooms", async (_req, res) => {
  try {
    const rooms = await matchMaker.query({ name: "game", private: false });
    res.json(
      rooms.map((r) => ({
        roomId: r.roomId,
        lobbyName: r.metadata?.lobbyName || "Лобби",
        phase: r.metadata?.phase || "lobby",
        clients: r.clients,
        maxClients: r.maxClients,
      }))
    );
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "ошибка" });
  }
});

// Поиск комнаты по коду (приватные лобби).
app.get("/rooms/by-code", async (req, res) => {
  const code = String(req.query.code || "").toUpperCase().trim();
  if (!code) return res.status(400).json({ error: "нужен код" });
  const rooms = await matchMaker.query({ name: "game" });
  const r = rooms.find((x) => (x.metadata?.code || "") === code);
  if (!r) return res.status(404).json({ error: "лобби с таким кодом не найдено" });
  res.json({ roomId: r.roomId, lobbyName: r.metadata?.lobbyName || "Лобби" });
});

// Раздача собранного веб-приложения (npm run build:web кладёт его в ./public).
const publicDir = path.join(__dirname, "..", "public");
const hasWebBuild = fs.existsSync(path.join(publicDir, "index.html"));
if (hasWebBuild) {
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  console.log("  Веб-приложение: раздаётся из ./public");
} else {
  app.get("/", (_req, res) => res.send("Monopoly game server OK (web build отсутствует)"));
}

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

httpServer.listen(port, () => {
  console.log(`\n  Monopoly game server:  ws://localhost:${port}`);
  console.log(`  Monitor:               http://localhost:${port}/monitor\n`);
});
