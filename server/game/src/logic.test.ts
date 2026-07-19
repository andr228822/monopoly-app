import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canStart, pushRateWindow } from "./logic";

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
