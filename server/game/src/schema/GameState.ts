import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
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
  @type("boolean") isBot = false; // бот-соперник (управляется сервером)

  // серверное (не синкается): порядок хода + счётчик неудачных попыток дубля в тюрьме
  turnIndex = 0;
  jailTurns = 0;
}

// Владение клеткой недвижимости/ж.д./коммунальной. Ключ карты — id клетки (строкой).
export class PropertyState extends Schema {
  @type("string") ownerId = "";      // "" = банк (не куплено)
  @type("uint8") houses = 0;         // 0-4 дома, 5 = отель (только для участков)
  @type("boolean") mortgaged = false; // заложено — аренда не берётся
}

// Активное предложение обмена (Фаза 4). fromId === "" — обмена нет.
// offer* — что отдаёт предлагающий (fromId), request* — что просит взамен у получателя (toId).
export class TradeOffer extends Schema {
  @type("string") fromId = "";
  @type("string") toId = "";
  @type(["uint8"]) offerProps = new ArraySchema<number>();   // id клеток от предлагающего
  @type(["uint8"]) requestProps = new ArraySchema<number>(); // id клеток от получателя
  @type("int32") offerMoney = 0;
  @type("int32") requestMoney = 0;
  @type("uint8") offerCards = 0;   // карты «выход из тюрьмы»
  @type("uint8") requestCards = 0;
  @type("uint32") deadline = 0;    // сек эпохи — для отсчёта на клиенте
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

  // Аукцион (Фаза 3): 255 = нет активного аукциона.
  @type("uint8") auctionTileId = 255;
  @type("int32") auctionBid = 0;
  @type("string") auctionBidderId = ""; // текущий лидер ("" = ставок нет)
  @type(["string"]) auctionBidders = new ArraySchema<string>(); // кто ещё в торгах
  @type("uint32") auctionDeadline = 0;  // ms epoch — для отсчёта на клиенте

  // Обмен (Фаза 4): постоянный инстанс, fromId === "" когда обмена нет.
  @type(TradeOffer) trade = new TradeOffer();
}
