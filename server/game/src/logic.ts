// Чистая игровая логика (без Colyseus/сети) — единая точка для юнит-тестов.
import { GAME_CONFIG, TileType, tileAt, type Tile } from "@monopoly/shared";

export interface PlayerLike {
  id: string;
  ready?: boolean;
}

// Можно ли стартовать матч: хватает игроков, и все нажали «готов».
export function canStart(
  players: PlayerLike[],
  minPlayers = GAME_CONFIG.minPlayersToStart
): boolean {
  if (players.length < minPlayers) return false;
  return players.every((p) => p.ready);
}

// Скользящее окно анти-флуда: чистим старые метки, добавляем текущую, сообщаем
// о превышении. Возвращает обновлённый массив (его надо сохранить обратно).
export function pushRateWindow(
  times: number[],
  now: number,
  windowMs: number,
  max: number
): { times: number[]; limited: boolean } {
  const arr = times.filter((t) => now - t < windowMs);
  arr.push(now);
  return { times: arr, limited: arr.length > max };
}

// ── Фаза 1: базовая игровая логика ──

// Новая позиция после броска + прошёл ли игрок «Старт» (бонус 200).
export function computeMove(position: number, d1: number, d2: number): { to: number; passedGo: boolean } {
  const sum = position + d1 + d2;
  return { to: sum % 40, passedGo: sum >= 40 };
}

// Может ли клетка быть куплена (недвижимость/ж.д./коммунальная).
export function isPurchasable(tile: Tile): boolean {
  return tile.type === TileType.Property || tile.type === TileType.Railroad || tile.type === TileType.Utility;
}

// Базовая аренда (без домов/монополии/владения всеми ж.д. — Фаза 3).
// Коммунальные — по сумме кубиков текущего хода, остальное — фикс. ставка клетки.
export function rentFor(tile: Tile, d1: number, d2: number): number {
  if (tile.type === TileType.Utility) return (d1 + d2) * GAME_CONFIG.utilityRentPerDice;
  return tile.rent ?? 0;
}

// Следующий живой (не банкрот) игрок по кругу от текущего в заданном порядке ходов.
export function nextAlivePlayerId(
  turnOrder: string[],
  currentId: string,
  bankruptIds: Set<string>
): string {
  const n = turnOrder.length;
  const start = turnOrder.indexOf(currentId);
  for (let i = 1; i <= n; i++) {
    const id = turnOrder[(start + i) % n];
    if (!bankruptIds.has(id)) return id;
  }
  return "";
}

// Дубль — оба кубика показали одно и то же значение (даёт лишний бросок).
export function isDouble(d1: number, d2: number): boolean {
  return d1 === d2;
}

// Исход броска кубиков в тюрьме:
//  escape     — выпал дубль, выходим и ходим на этот бросок (без доп. хода);
//  forced_pay — исчерпаны попытки (это N-я неудача), выход принудительный со штрафом;
//  stay       — остаёмся в тюрьме, ход переходит дальше.
export function jailRollOutcome(
  double: boolean,
  jailTurnsAfter: number, // сколько неудачных попыток УЖЕ накоплено (включая текущую)
  maxJailTurns = GAME_CONFIG.maxJailTurns
): "escape" | "forced_pay" | "stay" {
  if (double) return "escape";
  return jailTurnsAfter >= maxJailTurns ? "forced_pay" : "stay";
}

// Перемещение на конкретную клетку (карта): вперёд по кругу, с проходом Старта.
export function moveToTile(from: number, to: number): { to: number; passedGo: boolean } {
  return { to, passedGo: to < from }; // если целевая клетка «позади» — значит прошли Старт
}

// Победитель: если живых (не банкрот) участников <= 1 — вернуть его id ("" если никого).
export function resolveWinner<T extends { id: string; bankrupt?: boolean }>(players: T[]): string | null {
  const alive = players.filter((p) => !p.bankrupt);
  return alive.length <= 1 ? (alive[0]?.id ?? "") : null;
}

export { tileAt };
