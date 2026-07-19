import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { ClientMsg } from "@monopoly/shared";
import { GameRoom } from "./rooms/GameRoom";

// Интеграционные тесты лобби (Фаза 0). Игровая логика — Фаза 1+.
describe("GameRoom (интеграция, лобби)", () => {
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
