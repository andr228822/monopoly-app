import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canStart, pushRateWindow, computeMove, isPurchasable, rentFor, nextAlivePlayerId, resolveWinner, jailRollOutcome, moveToTile, mortgageValue, unmortgageCost, canBuildHouse, canSellHouse } from "./logic";
import { tileAt, GAME_CONFIG, drawCard, CHANCE_DECK, CHEST_DECK, MONEY_SCALE, RAILROAD_RENT } from "@monopoly/shared";

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
});

describe("rentFor (Фаза 3)", () => {
  const own = (id: number, ownerId: string, houses = 0, mortgaged = false) =>
    ({ [id]: { ownerId, houses, mortgaged } });

  it("участок без монополии — базовая аренда rents[0]", () => {
    const props = own(1, "x"); // brown = {1,3}, владеем только 1 → не монополия
    assert.equal(rentFor(tileAt(1), props, 1, 1), tileAt(1).rents![0]);
  });
  it("монополия без домов — аренда ×2", () => {
    const props = { ...own(1, "x"), ...own(3, "x") };
    assert.equal(rentFor(tileAt(1), props, 1, 1), tileAt(1).rents![0] * 2);
  });
  it("с домами — аренда rents[houses]", () => {
    const props = { ...own(1, "x", 3), ...own(3, "x") };
    assert.equal(rentFor(tileAt(1), props, 1, 1), tileAt(1).rents![3]);
  });
  it("заложенная клетка — аренды нет", () => {
    const props = { ...own(1, "x", 0, true), ...own(3, "x") };
    assert.equal(rentFor(tileAt(1), props, 1, 1), 0);
  });
  it("ж/д — по числу вокзалов у владельца", () => {
    assert.equal(rentFor(tileAt(5), own(5, "x"), 1, 1), RAILROAD_RENT[0]);
    const two = { ...own(5, "x"), ...own(15, "x") };
    assert.equal(rentFor(tileAt(5), two, 1, 1), RAILROAD_RENT[1]);
  });
  it("коммунальная — сумма кубиков ×4 (одна) или ×10 (обе)", () => {
    assert.equal(rentFor(tileAt(12), own(12, "x"), 3, 4), 7 * 4 * MONEY_SCALE);
    const both = { ...own(12, "x"), ...own(28, "x") };
    assert.equal(rentFor(tileAt(12), both, 3, 4), 7 * 10 * MONEY_SCALE);
  });
});

describe("ипотека и застройка (Фаза 3)", () => {
  const own = (id: number, ownerId: string, houses = 0, mortgaged = false) =>
    ({ [id]: { ownerId, houses, mortgaged } });
  const brown = (a: number, b: number, ma = false, mb = false) =>
    ({ ...own(1, "x", a, ma), ...own(3, "x", b, mb) }); // группа brown = {1,3}

  it("залог = 50% цены, выкуп = 55%", () => {
    assert.equal(mortgageValue(tileAt(1).price!), tileAt(1).price! / 2);
    assert.equal(unmortgageCost(tileAt(1).price!), Math.round(tileAt(1).price! * 0.55));
  });

  it("строить нельзя без монополии", () => {
    assert.equal(canBuildHouse(own(1, "x"), 1, "x"), false); // владеем только 1 из brown
  });
  it("монополия, равномерно — строить можно", () => {
    assert.equal(canBuildHouse(brown(0, 0), 1, "x"), true);
  });
  it("равномерность: нельзя обгонять минимум группы", () => {
    assert.equal(canBuildHouse(brown(1, 0), 1, "x"), false); // на 1 уже дом, у 3 — нет
    assert.equal(canBuildHouse(brown(1, 0), 3, "x"), true);  // достраиваем отстающую
  });
  it("заложенная клетка в группе блокирует стройку", () => {
    assert.equal(canBuildHouse(brown(0, 0, false, true), 1, "x"), false);
  });
  it("продавать можно с самой застроенной клетки группы", () => {
    assert.equal(canSellHouse(brown(2, 1), 1, "x"), true);  // у 1 больше
    assert.equal(canSellHouse(brown(2, 1), 3, "x"), false); // с отстающей нельзя
    assert.equal(canSellHouse(brown(0, 0), 1, "x"), false); // нечего продавать
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

describe("jailRollOutcome", () => {
  it("дубль — всегда выход", () => {
    assert.equal(jailRollOutcome(true, 1, 3), "escape");
    assert.equal(jailRollOutcome(true, 3, 3), "escape");
  });
  it("не дубль, попытки не исчерпаны — остаёмся", () => {
    assert.equal(jailRollOutcome(false, 1, 3), "stay");
    assert.equal(jailRollOutcome(false, 2, 3), "stay");
  });
  it("не дубль, попытки исчерпаны — принудительный выход со штрафом", () => {
    assert.equal(jailRollOutcome(false, 3, 3), "forced_pay");
  });
});

describe("moveToTile", () => {
  it("вперёд без прохода Старта", () => {
    assert.deepEqual(moveToTile(5, 20), { to: 20, passedGo: false });
  });
  it("на клетку позади — значит прошли Старт", () => {
    assert.deepEqual(moveToTile(36, 5), { to: 5, passedGo: true });
  });
});

describe("колоды карт", () => {
  it("суммы отмасштабированы ×MONEY_SCALE", () => {
    // "Банк выплачивает дивиденды" в Шансе = базовые 50 → 50*MONEY_SCALE
    const dividend = CHANCE_DECK.find((c) => c.text.includes("дивиденды"));
    assert.equal(dividend?.amount, 50 * MONEY_SCALE);
  });
  it("в обеих колодах есть «в тюрьму» и «выход бесплатно»", () => {
    for (const deck of [CHANCE_DECK, CHEST_DECK]) {
      assert.ok(deck.some((c) => c.effect === "go_to_jail"));
      assert.ok(deck.some((c) => c.effect === "get_out_free"));
    }
  });
  it("drawCard с детерминированным rnd возвращает конкретную карту", () => {
    assert.equal(drawCard("chance", () => 0), CHANCE_DECK[0]);
  });
});
