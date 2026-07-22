import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { ClientMsg, GAME_CONFIG, tileAt } from "@monopoly/shared";
import { GameRoom } from "./rooms/GameRoom";
import { PropertyState } from "./schema/GameState";
import { mortgageValue } from "./logic";

const RAILROAD5_PRICE = tileAt(5).price!; // цена «Северного вокзала» (клетка 5)

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

  it("ход: бросок двигает игрока, покупка недвижимости, ход передаётся автоматически", async () => {
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

    let restore = mockDice(2, 3); // 0+2+3=5 -> клетка 5 (ж.д., цена 200), не дубль
    a.send(ClientMsg.RollDice);
    await settle(room);
    restore();
    const pa = room.state.players.get(a.sessionId);
    assert.equal(pa.position, 5);
    assert.equal(room.state.awaitingBuyTileId, 5);

    b.send(ClientMsg.RollDice); // не её ход — игнор
    await settle(room);
    assert.equal(room.state.currentPlayerId, a.sessionId);

    a.send(ClientMsg.BuyProperty);
    await settle(room);
    assert.equal(room.state.properties.get("5").ownerId, a.sessionId);
    assert.equal(pa.money, GAME_CONFIG.startingMoney - RAILROAD5_PRICE);
    assert.equal(room.state.awaitingBuyTileId, 255);

    // Ручной "конец хода" не нужен — сервер сам передаёт очередь после паузы.
    await new Promise((r) => setTimeout(r, GAME_CONFIG.resolveDelayMs + 200));
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

    let restore = mockDice(2, 3); // A -> клетка 5 (ж.д., 200), не дубль
    a.send(ClientMsg.RollDice);
    await settle(room);
    restore();
    a.send(ClientMsg.BuyProperty);
    await new Promise((r) => setTimeout(r, GAME_CONFIG.resolveDelayMs + 200));
    await settle(room);
    assert.equal(room.state.currentPlayerId, b.sessionId);

    const pb = room.state.players.get(b.sessionId);
    pb.money = 10; // у B почти нет денег — аренда ж.д. уведёт в минус
    restore = mockDice(2, 3); // B тоже попадает на клетку 5 (чужую)
    b.send(ClientMsg.RollDice);
    await settle(room);
    restore();

    assert.equal(pb.bankrupt, true);
    assert.equal(room.state.phase, "game_over");
    assert.equal(room.state.winnerId, a.sessionId);

    await a.leave(); await b.leave();
  });

  it("дубль: тот же игрок бросает ещё раз, ход не передаётся", async () => {
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

    let restore = mockDice(3, 3); // дубль -> клетка 6 (недвижимость, но денег хватает — покупка спросится)
    a.send(ClientMsg.RollDice);
    await settle(room);
    restore();
    a.send(ClientMsg.DeclineBuy); // не покупаем, чтобы не мешало проверке

    await new Promise((r) => setTimeout(r, GAME_CONFIG.resolveDelayMs + 200));
    await settle(room);
    // Дубль — ход остался у A, кубики сброшены для нового броска.
    assert.equal(room.state.currentPlayerId, a.sessionId);
    assert.equal(room.state.dice1, 0);
    assert.equal(room.state.dice2, 0);

    await a.leave(); await b.leave();
  });

  it("3 дубля подряд отправляют в тюрьму, ход переходит дальше", async () => {
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

    for (let i = 0; i < 2; i++) {
      const restore = mockDice(2, 2); // дубль
      a.send(ClientMsg.RollDice);
      await settle(room);
      restore();
      if (room.state.awaitingBuyTileId !== 255) a.send(ClientMsg.DeclineBuy);
      await new Promise((r) => setTimeout(r, GAME_CONFIG.resolveDelayMs + 200));
      await settle(room);
      assert.equal(room.state.currentPlayerId, a.sessionId); // всё ещё её ход (1-й и 2-й дубль)
    }

    const restore = mockDice(5, 5); // 3-й дубль подряд -> тюрьма
    a.send(ClientMsg.RollDice);
    await settle(room);
    restore();
    const pa = room.state.players.get(a.sessionId);
    assert.equal(pa.position, GAME_CONFIG.jailTileId);
    assert.equal(pa.inJail, true);

    await new Promise((r) => setTimeout(r, GAME_CONFIG.resolveDelayMs + 200));
    await settle(room);
    assert.equal(room.state.currentPlayerId, b.sessionId); // 3 дубля — доп. хода нет, очередь дальше

    await a.leave(); await b.leave();
  });

  // Хелпер: довести комнату до фазы playing с 2 игроками, вернуть клиентов.
  async function startedGame() {
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
    return { room, a, b };
  }

  it("клетка «Иди в тюрьму» сажает в тюрьму", async () => {
    const { room, a, b } = await startedGame();
    const pa = room.state.players.get(a.sessionId);
    pa.position = 25; // 25 + 5 = 30 = клетка «Иди в тюрьму»
    const restore = mockDice(2, 3);
    a.send(ClientMsg.RollDice);
    await settle(room);
    restore();
    assert.equal(pa.inJail, true);
    assert.equal(pa.position, GAME_CONFIG.jailTileId);
    await a.leave(); await b.leave();
  });

  it("выход из тюрьмы по дублю: игрок ходит на выпавший бросок, доп. хода нет", async () => {
    const { room, a, b } = await startedGame();
    const pa = room.state.players.get(a.sessionId);
    pa.inJail = true;
    pa.position = GAME_CONFIG.jailTileId; // 10
    const restore = mockDice(5, 5); // дубль -> выход, 10+10=20 (Бесплатная парковка, без эффекта)
    a.send(ClientMsg.RollDice);
    await settle(room);
    restore();
    assert.equal(pa.inJail, false);
    assert.equal(pa.position, 20);

    await new Promise((r) => setTimeout(r, GAME_CONFIG.resolveDelayMs + 200));
    await settle(room);
    assert.equal(room.state.currentPlayerId, b.sessionId); // выход по дублю не даёт доп. ход
    await a.leave(); await b.leave();
  });

  it("не дубль в тюрьме: остаёмся, ход переходит; штраф освобождает", async () => {
    const { room, a, b } = await startedGame();
    const pa = room.state.players.get(a.sessionId);
    pa.inJail = true;
    pa.position = GAME_CONFIG.jailTileId;
    const restore = mockDice(2, 4); // не дубль -> остаёмся (1-я попытка из 3)
    a.send(ClientMsg.RollDice);
    await settle(room);
    restore();
    assert.equal(pa.inJail, true);
    assert.equal(pa.jailTurns, 1);

    await new Promise((r) => setTimeout(r, GAME_CONFIG.resolveDelayMs + 200));
    await settle(room);
    assert.equal(room.state.currentPlayerId, b.sessionId);
    await a.leave(); await b.leave();
  });

  it("оплата штрафа освобождает из тюрьмы", async () => {
    const { room, a, b } = await startedGame();
    const pa = room.state.players.get(a.sessionId);
    pa.inJail = true;
    pa.position = GAME_CONFIG.jailTileId;
    const before = pa.money;
    a.send(ClientMsg.PayJailFine);
    await settle(room);
    assert.equal(pa.inJail, false);
    assert.equal(pa.money, before - GAME_CONFIG.jailFine);
    await a.leave(); await b.leave();
  });

  // Выдать игроку клетки во владение (для тестов застройки/ипотеки).
  function grant(room: any, ownerId: string, ids: number[]) {
    for (const id of ids) {
      const prop = new PropertyState();
      prop.ownerId = ownerId;
      room.state.properties.set(String(id), prop);
    }
  }

  it("строительство дома: нужна монополия, списание houseCost, +1 дом", async () => {
    const { room, a, b } = await startedGame();
    const pa = room.state.players.get(a.sessionId);

    a.send(ClientMsg.BuildHouse, { tileId: 1 }); // без владения — игнор
    await settle(room);
    assert.equal(room.state.properties.get("1"), undefined);

    grant(room, a.sessionId, [1, 3]); // вся коричневая группа
    const before = pa.money;
    a.send(ClientMsg.BuildHouse, { tileId: 1 });
    await settle(room);
    assert.equal(room.state.properties.get("1").houses, 1);
    assert.equal(pa.money, before - tileAt(1).houseCost!);
    await a.leave(); await b.leave();
  });

  it("ипотека: залог даёт 50% цены и помечает клетку", async () => {
    const { room, a, b } = await startedGame();
    const pa = room.state.players.get(a.sessionId);
    grant(room, a.sessionId, [5]); // Северный вокзал
    const before = pa.money;
    a.send(ClientMsg.MortgageProperty, { tileId: 5 });
    await settle(room);
    assert.equal(room.state.properties.get("5").mortgaged, true);
    assert.equal(pa.money, before + mortgageValue(tileAt(5).price!));
    await a.leave(); await b.leave();
  });

  it("таймер хода: не успел походить — ход пропускается автоматически", async () => {
    // Широкое окно: A истекает в 2000мс, B — в 4000мс; проверяем в 2500мс.
    // Запас в ~1.5с с каждой стороны устойчив к дрожанию таймеров под нагрузкой сьюты.
    const room = await colyseus.createRoom("game", { turnMs: 2000 });
    const a = await colyseus.connectTo(room, { name: "A" });
    const b = await colyseus.connectTo(room, { name: "B" });
    await settle(room);
    a.send(ClientMsg.SetReady, { ready: true });
    b.send(ClientMsg.SetReady, { ready: true });
    await settle(room);
    a.send(ClientMsg.StartGame);
    await new Promise((r) => setTimeout(r, GAME_CONFIG.countdownMs + 200));
    await settle(room);
    assert.equal(room.state.currentPlayerId, a.sessionId);

    // A ничего не делает — таймер сам передаёт ход к B (окно [2000, 4000]мс).
    await new Promise((r) => setTimeout(r, 2500));
    await settle(room);
    assert.equal(room.state.currentPlayerId, b.sessionId);

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
