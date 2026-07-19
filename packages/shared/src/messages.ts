// Протокол клиент ↔ сервер (Фаза 0: только лобби, без игровой логики).

export const Phase = {
  Lobby: "lobby",
  Countdown: "countdown",
  Playing: "playing",
  GameOver: "game_over",
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const ClientMsg = {
  SetReady: "set_ready",
  StartGame: "start_game",
} as const;

export const ServerMsg = {
  PhaseChanged: "phase_changed",
} as const;
