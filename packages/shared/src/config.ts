// Конфиг игры — единый для сервера и клиента.

export const GAME_CONFIG = {
  minPlayersToStart: 2,
  maxPlayers: 6,
  countdownMs: 3000,
  startingMoney: 1500,
  passGoBonus: 200,
  utilityRentPerDice: 4, // Фаза 1: аренда коммунальных = сумма кубиков × это число
  turnMs: 60_000,        // лимит времени на ход — иначе авто-пропуск
  resolveDelayMs: 1400,  // пауза после броска перед авто-передачей хода (дать доиграть анимацию)
  jailTileId: 10,
} as const;
