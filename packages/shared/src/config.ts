// Конфиг игры — единый для сервера и клиента.

export const GAME_CONFIG = {
  minPlayersToStart: 2,
  maxPlayers: 6,
  countdownMs: 3000,
  startingMoney: 1500,
  passGoBonus: 200,
  utilityRentPerDice: 4, // Фаза 1: аренда коммунальных = сумма кубиков × это число
} as const;
