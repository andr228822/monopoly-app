// Конфиг игры — единый для сервера и клиента.

export const GAME_CONFIG = {
  minPlayersToStart: 2,
  maxPlayers: 6,
  countdownMs: 3000,
  startingMoney: 1500,
} as const;
