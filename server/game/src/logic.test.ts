import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canStart, pushRateWindow, computeMove, isPurchasable, rentFor, nextAlivePlayerId, resolveWinner } from "./logic";
import { tileAt, GAME_CONFIG } from "@monopoly/shared";

describe("canStart", () => {
  it("меньше минимума игроков — нельзя", () => {
    assert.equal(canStart([{ id: "a", ready: true }], 2), false);
  });
  it("хватает игроков, но не все готовы — нельзя", () => {
    assert.equal(canStart([{ id: "a", ready: true }, { id: "b", ready: false }], 2), false);
  });
  it("хватает игроков и все готовы — можно", () => {
    assert.equal(canStart([{ id: "a", ready: true }, { id: "b", ready: true }], 2), true);
  });
});

describe("pushRateWindow", () => {
  it("не превышает лимит — не лимитировано", () => {
    const { times, limited } = pushRateWindow([], 1000, 1000, 5);
    assert.equal(limited, false);
    assert.equal(times.length, 1);
  });
  it("превышает лимит в окне — лимитировано", () => {
    const now = 1000;
    const times = [now - 100, now - 200, now - 300, now - 400, now - 500];
    const res = pushRateWindow(times, now, 1000, 5);
    assert.equal(res.limited, true);
  });
  it("старые метки за окном — не считаются", () => {
    const now = 5000;
    const res = pushRateWindow([100, 200], now, 1000, 5);
    assert.equal(res.times.length, 1); // старые вычищены, добавлена новая
    assert.equal(res.limited, false);
  });
});

describe("computeMove", () => {
  it("обычное движение без прохода Старта", () => {
    assert.deepEqual(computeMove(0, 3, 4), { to: 7, passedGo: false });
  });
  it("проход через Старт даёт бонус", () => {
    assert.deepEqual(computeMove(38, 4, 3), { to: 5, passedGo: true });
  });
  it("попадание точно на Старт тоже считается проходом", () => {
    assert.deepEqual(computeMove(35, 3, 2), { to: 0, passedGo: true });
  });
});

describe("isPurchasable / rentFor", () => {
  it("недвижимость/ж.д./коммунальные покупаемы, остальное нет", () => {
    assert.equal(isPurchasable(tileAt(1)), true);   // property
    assert.equal(isPurchasable(tileAt(5)), true);   // railroad
    assert.equal(isPurchasable(tileAt(12)), true);  // utility
    assert.equal(isPurchasable(tileAt(0)), false);  // go
    assert.equal(isPurchasable(tileAt(4)), false);  // tax
  });
  it("аренда недвижимости — фикс. ставка клетки", () => {
    assert.equal(rentFor(tileAt(1), 1, 1), tileAt(1).rent);
  });
  it("аренда коммунальной — по сумме кубиков", () => {
    assert.equal(rentFor(tileAt(12), 3, 4), 7 * GAME_CONFIG.utilityRentPerDice);
  });
});

describe("nextAlivePlayerId", () => {
  it("идёт по кругу, пропуская банкротов", () => {
    const order = ["a", "b", "c", "d"];
    assert.equal(nextAlivePlayerId(order, "a", new Set()), "b");
    assert.equal(nextAlivePlayerId(order, "a", new Set(["b"])), "c");
    assert.equal(nextAlivePlayerId(order, "d", new Set()), "a"); // круг замыкается
  });
});

describe("resolveWinner", () => {
  it("больше одного живого — игра продолжается (null)", () => {
    assert.equal(resolveWinner([{ id: "a" }, { id: "b" }]), null);
  });
  it("остался один — он победитель", () => {
    assert.equal(resolveWinner([{ id: "a" }, { id: "b", bankrupt: true }]), "a");
  });
  it("никого не осталось — пустая строка", () => {
    assert.equal(resolveWinner([{ id: "a", bankrupt: true }]), "");
  });
});
