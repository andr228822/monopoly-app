import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { ClientMsg, GAME_CONFIG } from "@monopoly/shared";
import { GameRoom } from "./rooms/GameRoom";

// Кубики детерминируем через Math.random для интеграционных тестов Фазы 1.
// ВАЖНО: send() лишь кладёт сообщение в очередь — сервер обрабатывает его позже,
// асинхронно. Мок нужно держать активным до settle(), а не только на время send().
function mockDice(d1: number, d2: number): () => void {
  const seq = [(d1 - 0.5) / 6, (d2 - 0.5) / 6]; // середина интервала — без граничных ошибок округления
  let i = 0;
  const orig = Math.random;
  Math.random = () => seq[i++ % seq.length];
  return () => { Math.random = orig; };
}

// Интеграционные тесты комнаты: лобби (Фаза 0) + базовый игровой луп (Фаза 1).
describe("GameRoom (интеграция)", () => {
  let colyseus: ColyseusTestServer;

  before(async () => {
    colyseus = await boot({ initializeGameServer: (gs: any) => gs.define("game", GameRoom) });
  });
  after(async () => { await colyseus.shutdown(); });

  const settle = async (room: any) => { await room.waitForNextPatch(); await room.waitForNextPatch(); };

  it("join: первый игрок — хост, второй — обычный", async () => {
    const room = await colyseus.createRoom("game", { lobbyName: "Test" });
    const a = await colyseus.connectTo(room, { name: "Alice" });
    const b = await colyseus.connectTo(room, { name: "Bob" });
    await settle(room);
    assert.equal(room.state.players.size, 2);
    assert.equal(room.state.hostId, a.sessionId);
    assert.notEqual(room.state.hostId, b.sessionId);
    await a.leave(); await b.leave();
  });

  it("старт: не-хост не стартует; хост — только когда все готовы", async () => {
    const room = await colyseus.createRoom("game", {});
    const a = await colyseus.connectTo(room, { name: "A" });
    const b = await colyseus.connectTo(room, { name: "B" });
    await settle(room);

    b.send(ClientMsg.StartGame); // не-хост
    await settle(room);
    assert.equal(room.state.phase, "lobby");

    a.send(ClientMsg.StartGame); // хост, но не все готовы
    await settle(room);
    assert.equal(room.state.phase, "lobby");

    a.send(ClientMsg.SetReady, { ready: true });
    b.send(ClientMsg.SetReady, { ready: true });
    await settle(room);
    a.send(ClientMsg.StartGame); // теперь можно
    await settle(room);
    assert.equal(room.state.phase, "countdown");

    await a.leave(); await b.leave();
  });

  it("ход: бросок двигает игрока, покупка недвижимости, конец хода передаёт очередь", async () => {
    const room = await colyseus.createRoom("game", {});
    const a = await colyseus.connectTo(room, { name: "A" });
    const b = await colyseus.connectTo(room, { name: "B" });
    await settle(room);
    a.send(ClientMsg.SetReady, { ready: true });
    b.send(ClientMsg.SetReady, { ready: true });
    await settle(room);
    a.send(ClientMsg.StartGame);
    await new Promise((r) => setTimeout(r, GAME_CONFIG.countdownMs + 200));
    await settle(room);
    assert.equal(room.state.phase, "playing");
    assert.equal(room.state.currentPlayerId, a.sessionId); // первый вошедший ходит первым

    let restore = mockDice(2, 3); // 0+2+3=5 -> клетка 5 (ж.д., цена 200)
    a.send(ClientMsg.RollDice);
    await settle(room);
    restore();
    const pa = room.state.players.get(a.sessionId);
    assert.equal(pa.position, 5);
    assert.equal(room.state.awaitingBuyTileId, 5);

    b.send(ClientMsg.RollDice); // не её ход — игнор
    await settle(room);
    assert.equal(room.state.currentPlayerId, a.sessionId);

    a.send(ClientMsg.EndTurn); // нельзя закончить ход, пока не решена покупка
    await settle(room);
    assert.equal(room.state.currentPlayerId, a.sessionId);

    a.send(ClientMsg.BuyProperty);
    await settle(room);
    assert.equal(room.state.properties.get("5").ownerId, a.sessionId);
    assert.equal(pa.money, GAME_CONFIG.startingMoney - 200);
    assert.equal(room.state.awaitingBuyTileId, 255);

    a.send(ClientMsg.EndTurn);
    await settle(room);
    assert.equal(room.state.currentPlayerId, b.sessionId);

    await a.leave(); await b.leave();
  });

  it("аренда: игрок платит владельцу клетки, при уходе в минус — банкротство и победа", async () => {
    const room = await colyseus.createRoom("game", {});
    const a = await colyseus.connectTo(room, { name: "A" });
    const b = await colyseus.connectTo(room, { name: "B" });
    await settle(room);
    a.send(ClientMsg.SetReady, { ready: true });
    b.send(ClientMsg.SetReady, { ready: true });
    await settle(room);
    a.send(ClientMsg.StartGame);
    await new Promise((r) => setTimeout(r, GAME_CONFIG.countdownMs + 200));
    await settle(room);

    let restore = mockDice(2, 3); // A -> клетка 5 (ж.д., 200)
    a.send(ClientMsg.RollDice);
    await settle(room);
    restore();
    a.send(ClientMsg.BuyProperty);
    await settle(room);
    a.send(ClientMsg.EndTurn);
    await settle(room);
    assert.equal(room.state.currentPlayerId, b.sessionId);

    const pb = room.state.players.get(b.sessionId);
    pb.money = 10; // у B почти нет денег — аренда 25 уведёт в минус
    restore = mockDice(2, 3); // B тоже попадает на клетку 5 (чужую)
    b.send(ClientMsg.RollDice);
    await settle(room);
    restore();

    assert.equal(pb.bankrupt, true);
    assert.equal(room.state.phase, "game_over");
    assert.equal(room.state.winnerId, a.sessionId);

    await a.leave(); await b.leave();
  });

  it("выход хоста: игрок удаляется, хост переназначается", async () => {
    const room = await colyseus.createRoom("game", {});
    const a = await colyseus.connectTo(room, { name: "A" });
    const b = await colyseus.connectTo(room, { name: "B" });
    await settle(room);
    assert.equal(room.state.hostId, a.sessionId);

    await a.leave();
    await settle(room);
    assert.equal(room.state.players.size, 1);
    assert.equal(room.state.hostId, b.sessionId);
    await b.leave();
  });
});
