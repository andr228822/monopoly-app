import { Schema, MapSchema, type } from "@colyseus/schema";
import { GAME_CONFIG } from "@monopoly/shared";

// Синхронизируемое состояние комнаты.
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("string") avatar = "";
  @type("boolean") ready = false;
  @type("boolean") connected = true;
  @type("int32") money = GAME_CONFIG.startingMoney;
  @type("uint8") position = 0;
  @type("boolean") bankrupt = false;
  @type("boolean") inJail = false;
  @type("uint8") getOutCards = 0; // карт «выход из тюрьмы бесплатно» в запасе

  // серверное (не синкается): порядок хода + счётчик неудачных попыток дубля в тюрьме
  turnIndex = 0;
  jailTurns = 0;
}

// Владение клеткой недвижимости/ж.д./коммунальной. Ключ карты — id клетки (строкой).
export class PropertyState extends Schema {
  @type("string") ownerId = ""; // "" = банк (не куплено)
}

export class GameState extends Schema {
  @type("string") phase = "lobby";
  @type("string") lobbyName = "";
  @type("string") code = "";
  @type("uint8") maxPlayers = 6;
  @type("string") hostId = "";
  @type({ map: Player }) players = new MapSchema<Player>();

  @type("string") currentPlayerId = "";
  @type("uint8") dice1 = 0;
  @type("uint8") dice2 = 0;
  @type("uint8") awaitingBuyTileId = 255; // 255 = нет ожидающего решения о покупке
  @type({ map: PropertyState }) properties = new MapSchema<PropertyState>();
  @type("string") winnerId = "";
}
