// Чистая игровая логика (без Colyseus/сети) — единая точка для юнит-тестов.
import {
  GAME_CONFIG, TileType, tileAt, groupTiles, BOARD, RAILROAD_RENT, UTILITY_MULT, MONEY_SCALE, type Tile,
} from "@monopoly/shared";

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

// Владения (срез синк-состояния): tileId -> кто владеет, дома, заложено.
export interface PropView { ownerId: string; houses: number; mortgaged: boolean }
export type PropsMap = Record<number, PropView | undefined>;

// Владеет ли ownerId ВСЕЙ цветовой группой (монополия).
export function ownsWholeGroup(props: PropsMap, group: string, ownerId: string): boolean {
  const tiles = groupTiles(group);
  return tiles.length > 0 && tiles.every((t) => props[t.id]?.ownerId === ownerId);
}

// Сколько клеток заданного типа во владении ownerId (для ж/д и коммунальных).
export function countOwnedOfType(props: PropsMap, type: TileType, ownerId: string): number {
  return BOARD.filter((t) => t.type === type && props[t.id]?.ownerId === ownerId).length;
}

// Аренда с учётом застройки/монополии/числа ж/д и коммунальных.
// Заложенная клетка аренду не приносит. Коммунальные — по сумме кубиков.
export function rentFor(tile: Tile, props: PropsMap, d1: number, d2: number): number {
  const prop = props[tile.id];
  if (!prop || !prop.ownerId || prop.mortgaged) return 0;

  if (tile.type === TileType.Property) {
    const rents = tile.rents || [0];
    if (prop.houses > 0) return rents[Math.min(prop.houses, 5)] ?? 0;
    // без домов: монополия удваивает базовую аренду
    return ownsWholeGroup(props, tile.group!, prop.ownerId) ? (rents[0] ?? 0) * 2 : rents[0] ?? 0;
  }
  if (tile.type === TileType.Railroad) {
    const n = countOwnedOfType(props, TileType.Railroad, prop.ownerId);
    return RAILROAD_RENT[Math.max(0, Math.min(n, 4) - 1)] ?? 0;
  }
  if (tile.type === TileType.Utility) {
    const n = countOwnedOfType(props, TileType.Utility, prop.ownerId);
    return (d1 + d2) * (n >= 2 ? UTILITY_MULT.both : UTILITY_MULT.one) * MONEY_SCALE;
  }
  return 0;
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

// ── Ипотека и застройка (Фаза 3) ──
export function mortgageValue(price: number): number {
  return Math.floor(price / 2);
}
export function unmortgageCost(price: number): number {
  return Math.round(price * 0.55); // залог 50% + 10% процент
}

function housesInGroup(props: PropsMap, group: string): number[] {
  return groupTiles(group).map((t) => (t.type === TileType.Property ? props[t.id]?.houses ?? 0 : 0));
}

// Можно ли построить дом/отель на этой клетке (равномерная застройка).
export function canBuildHouse(props: PropsMap, tileId: number, ownerId: string): boolean {
  const tile = tileAt(tileId);
  if (tile.type !== TileType.Property || !tile.group) return false;
  if (!ownsWholeGroup(props, tile.group, ownerId)) return false;
  // ни одна клетка группы не должна быть заложена
  if (groupTiles(tile.group).some((t) => props[t.id]?.mortgaged)) return false;
  const cur = props[tileId]?.houses ?? 0;
  if (cur >= 5) return false; // уже отель
  // равномерность: строим только если у этой клетки не больше домов, чем у минимальной в группе
  const min = Math.min(...housesInGroup(props, tile.group));
  return cur === min;
}

// Можно ли продать дом/отель с этой клетки (равномерность в обратную сторону).
export function canSellHouse(props: PropsMap, tileId: number, ownerId: string): boolean {
  const tile = tileAt(tileId);
  if (tile.type !== TileType.Property || !tile.group) return false;
  if (props[tileId]?.ownerId !== ownerId) return false;
  const cur = props[tileId]?.houses ?? 0;
  if (cur <= 0) return false;
  const max = Math.max(...housesInGroup(props, tile.group));
  return cur === max;
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
