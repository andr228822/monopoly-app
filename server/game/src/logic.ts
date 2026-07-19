// Чистая игровая логика (без Colyseus/сети) — единая точка для юнит-тестов.
// Фаза 0: только гейт старта лобби и анти-флуд. Правила Монополии — Фаза 1+.
import { GAME_CONFIG } from "@monopoly/shared";

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
