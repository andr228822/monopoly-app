// Протокол клиент ↔ сервер.
// Фаза 1: базовый играбельный луп (кубики/движение/покупка/аренда/банкротство).
// Карты Шанс/Казна, тюрьма, аукцион, ипотека, дома/трейд — следующие фазы.

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
  RollDice: "roll_dice",
  BuyProperty: "buy_property",
  DeclineBuy: "decline_buy",
  PayJailFine: "pay_jail_fine",   // выйти из тюрьмы за штраф (потом бросить и ходить)
  UseJailCard: "use_jail_card",   // выйти из тюрьмы картой «выход бесплатно»
} as const;

export const ServerMsg = {
  PhaseChanged: "phase_changed",
  DiceRolled: "dice_rolled",
  PlayerMoved: "player_moved",
  RentPaid: "rent_paid",
  PlayerBankrupt: "player_bankrupt",
  GameOver: "game_over",
  TurnStarted: "turn_started",
  CardDrawn: "card_drawn",        // игрок вытянул карту Шанс/Казна
} as const;

export interface DiceRolledPayload { playerId: string; d1: number; d2: number; isDouble: boolean }
// direct=true — телепорт (например, отправка в тюрьму за 3 дубля): клиент не идёт
// пошагово по клеткам, а сразу переставляет фишку.
export interface PlayerMovedPayload { playerId: string; from: number; to: number; passedGo: boolean; direct?: boolean }
export interface RentPaidPayload { fromId: string; toId: string; amount: number; tileId: number }
export interface PlayerBankruptPayload { playerId: string }
export interface GameOverPayload { winnerId: string }
export interface TurnStartedPayload { playerId: string; deadline: number }
export interface CardDrawnPayload { playerId: string; deck: "chance" | "chest"; text: string }
