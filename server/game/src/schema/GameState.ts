import { Schema, MapSchema, type } from "@colyseus/schema";

// Синхронизируемое состояние комнаты (Фаза 0: только лобби).
// Игровые поля (деньги/позиция/недвижимость и т.д.) появятся в Фазе 1.
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("string") avatar = "";
  @type("boolean") ready = false;
  @type("boolean") connected = true;
}

export class GameState extends Schema {
  @type("string") phase = "lobby";
  @type("string") lobbyName = "";
  @type("string") code = "";
  @type("uint8") maxPlayers = 6;
  @type("string") hostId = "";
  @type({ map: Player }) players = new MapSchema<Player>();
}
