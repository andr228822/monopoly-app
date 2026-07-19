import { Room, Client } from "colyseus";
import { GameState, Player, PropertyState } from "../schema/GameState";
import { GAME_CONFIG, Phase, ClientMsg, ServerMsg, TileType } from "@monopoly/shared";
import {
  canStart, pushRateWindow, computeMove, isPurchasable, rentFor,
  nextAlivePlayerId, resolveWinner, tileAt,
} from "../logic";

interface CreateOptions {
  lobbyName?: string;
  isPrivate?: boolean;
  maxPlayers?: number;
  code?: string;
}

// Лёгкий анти-флуд: не больше N сообщений в окне на клиента.
const MSG_RATE_MAX = 25;
const MSG_RATE_WINDOW_MS = 1000;

export class GameRoom extends Room<GameState> {
  maxClients = 6;
  code = "";
  private msgRate = new Map<string, number[]>();
  // Порядок хода — фиксируется один раз при старте матча (не синкается).
  private turnOrder: string[] = [];

  onCreate(options: CreateOptions = {}) {
    this.setState(new GameState());
    this.state.lobbyName = (options.lobbyName || "Лобби").slice(0, 24);
    this.maxClients = Math.min(Math.max(options.maxPlayers || 6, 2), GAME_CONFIG.maxPlayers);
    this.state.maxPlayers = this.maxClients;
    this.code = options.code || Math.random().toString(36).slice(2, 8).toUpperCase();
    this.state.code = this.code;
    if (options.isPrivate) this.setPrivate(true);
    this.syncMetadata();

    this.onMessage(ClientMsg.SetReady, (client, msg: { ready?: boolean }) => {
      if (this.rateLimited(client)) return;
      if (typeof msg?.ready !== "boolean") return;
      const p = this.state.players.get(client.sessionId);
      if (p && this.state.phase === Phase.Lobby) p.ready = msg.ready;
    });

    this.onMessage(ClientMsg.StartGame, (client) => {
      if (this.rateLimited(client)) return;
      this.tryStart(client);
    });

    this.onMessage(ClientMsg.RollDice, (client) => {
      if (this.rateLimited(client)) return;
      this.handleRollDice(client);
    });

    this.onMessage(ClientMsg.BuyProperty, (client) => {
      if (this.rateLimited(client)) return;
      this.handleBuyProperty(client);
    });

    this.onMessage(ClientMsg.DeclineBuy, (client) => {
      if (this.rateLimited(client)) return;
      if (!this.isMyTurnWithPendingBuy(client)) return;
      this.state.awaitingBuyTileId = 255;
    });

    this.onMessage(ClientMsg.EndTurn, (client) => {
      if (this.rateLimited(client)) return;
      if (this.state.phase !== Phase.Playing) return;
      if (client.sessionId !== this.state.currentPlayerId) return;
      if (this.state.awaitingBuyTileId !== 255) return; // сначала реши покупку
      this.advanceTurn();
    });
  }

  private rateLimited(client: Client): boolean {
    const { times, limited } = pushRateWindow(
      this.msgRate.get(client.sessionId) || [], Date.now(), MSG_RATE_WINDOW_MS, MSG_RATE_MAX
    );
    this.msgRate.set(client.sessionId, times);
    return limited;
  }

  onJoin(client: Client, options: { name?: string; avatar?: string }) {
    const p = new Player();
    p.id = client.sessionId;
    p.name = options?.name || `Player-${client.sessionId.slice(0, 4)}`;
    p.avatar = String(options?.avatar || "").slice(0, 8);
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    console.log(`[room ${this.roomId}] +${p.name} (${this.state.players.size} в комнате)`);
  }

  async onLeave(client: Client, consented?: boolean) {
    this.msgRate.delete(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    const inMatch = this.state.phase === Phase.Countdown || this.state.phase === Phase.Playing;

    if (consented || !inMatch || !p) {
      this.removePlayer(client.sessionId);
      return;
    }

    p.connected = false;
    try {
      await this.allowReconnection(client, 30);
      const back = this.state.players.get(client.sessionId);
      if (back) back.connected = true;
    } catch {
      this.removePlayer(client.sessionId);
    }
  }

  private removePlayer(sessionId: string) {
    const p = this.state.players.get(sessionId);
    // В разгаре матча ушедший игрок навсегда — считаем банкротом, чтобы игра
    // не зависла в ожидании его хода (Фаза 1: полноценного удаления из партии нет).
    if (p && this.state.phase === Phase.Playing && !p.bankrupt) {
      this.bankruptPlayer(p);
    }
    this.state.players.delete(sessionId);
    this.msgRate.delete(sessionId);
    if (this.state.hostId === sessionId) {
      this.state.hostId = [...this.state.players.keys()][0] || "";
    }
  }

  private setPhase(phase: Phase) {
    this.state.phase = phase;
    if (phase === Phase.Lobby) this.unlock();
    else this.lock();
    this.broadcast(ServerMsg.PhaseChanged, { phase });
    this.syncMetadata();
    console.log(`[room ${this.roomId}] фаза -> ${phase}`);
  }

  private syncMetadata() {
    this.setMetadata({
      lobbyName: this.state.lobbyName,
      code: this.code,
      phase: this.state.phase,
    });
  }

  private tryStart(client: Client) {
    if (client.sessionId !== this.state.hostId) return;
    if (this.state.phase !== Phase.Lobby) return;
    if (!canStart([...this.state.players.values()])) return;

    this.setPhase(Phase.Countdown);
    this.clock.setTimeout(() => this.beginRound(), GAME_CONFIG.countdownMs);
  }

  private beginRound() {
    this.turnOrder = [...this.state.players.keys()];
    this.state.properties.clear();
    for (const p of this.state.players.values()) {
      p.money = GAME_CONFIG.startingMoney;
      p.position = 0;
      p.bankrupt = false;
    }
    this.state.winnerId = "";
    this.state.dice1 = 0;
    this.state.dice2 = 0;
    this.state.awaitingBuyTileId = 255;
    this.state.currentPlayerId = this.turnOrder[0] || "";
    this.setPhase(Phase.Playing);
  }

  private isMyTurnWithPendingBuy(client: Client): boolean {
    return (
      this.state.phase === Phase.Playing &&
      client.sessionId === this.state.currentPlayerId &&
      this.state.awaitingBuyTileId !== 255
    );
  }

  private handleRollDice(client: Client) {
    if (this.state.phase !== Phase.Playing) return;
    if (client.sessionId !== this.state.currentPlayerId) return;
    if (this.state.awaitingBuyTileId !== 255) return; // сначала реши покупку
    const p = this.state.players.get(client.sessionId);
    if (!p || p.bankrupt) return;

    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    this.state.dice1 = d1;
    this.state.dice2 = d2;
    this.broadcast(ServerMsg.DiceRolled, { playerId: p.id, d1, d2 });

    const from = p.position;
    const { to, passedGo } = computeMove(p.position, d1, d2);
    p.position = to;
    if (passedGo) p.money += GAME_CONFIG.passGoBonus;
    this.broadcast(ServerMsg.PlayerMoved, { playerId: p.id, from, to, passedGo });

    this.resolveTile(p, d1, d2);
  }

  private resolveTile(p: Player, d1: number, d2: number) {
    const tile = tileAt(p.position);
    if (isPurchasable(tile)) {
      const prop = this.state.properties.get(String(tile.id));
      const ownerId = prop?.ownerId || "";
      if (!ownerId) {
        if (p.money >= (tile.price || 0)) this.state.awaitingBuyTileId = tile.id;
      } else if (ownerId !== p.id) {
        const owner = this.state.players.get(ownerId);
        if (owner && !owner.bankrupt) this.payRent(p, owner, rentFor(tile, d1, d2), tile.id);
      }
    } else if (tile.type === TileType.Tax) {
      this.chargeMoney(p, tile.tax || 0, "");
    }
    // go/chance/chest/jail/free_parking/go_to_jail — пока без эффекта (Фаза 2+).
  }

  private payRent(payer: Player, owner: Player, amount: number, tileId: number) {
    payer.money -= amount;
    owner.money += amount;
    this.broadcast(ServerMsg.RentPaid, { fromId: payer.id, toId: owner.id, amount, tileId });
    if (payer.money < 0) this.bankruptPlayer(payer);
  }

  // Налог уходит в банк (creditorId="" — просто теряются деньги, никому не зачисляются).
  private chargeMoney(p: Player, amount: number, _creditorId: string) {
    p.money -= amount;
    if (p.money < 0) this.bankruptPlayer(p);
  }

  private bankruptPlayer(p: Player) {
    p.bankrupt = true;
    for (const prop of this.state.properties.values()) {
      if (prop.ownerId === p.id) prop.ownerId = ""; // имущество возвращается банку
    }
    this.broadcast(ServerMsg.PlayerBankrupt, { playerId: p.id });

    const winner = resolveWinner([...this.state.players.values()]);
    if (winner !== null) {
      this.state.winnerId = winner;
      this.setPhase(Phase.GameOver);
      this.broadcast(ServerMsg.GameOver, { winnerId: winner });
      console.log(`[room ${this.roomId}] 🏆 Победитель: ${winner || "никто"}`);
    } else if (this.state.currentPlayerId === p.id) {
      this.advanceTurn();
    }
  }

  private handleBuyProperty(client: Client) {
    if (!this.isMyTurnWithPendingBuy(client)) return;
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const tile = tileAt(this.state.awaitingBuyTileId);
    const price = tile.price || 0;
    if (p.money < price) return;
    p.money -= price;
    const key = String(tile.id);
    let prop = this.state.properties.get(key);
    if (!prop) {
      prop = new PropertyState();
      this.state.properties.set(key, prop);
    }
    prop.ownerId = p.id;
    this.state.awaitingBuyTileId = 255;
  }

  private advanceTurn() {
    const bankruptIds = new Set(
      [...this.state.players.values()].filter((p) => p.bankrupt).map((p) => p.id)
    );
    this.state.currentPlayerId = nextAlivePlayerId(this.turnOrder, this.state.currentPlayerId, bankruptIds);
    this.state.dice1 = 0;
    this.state.dice2 = 0;
    this.state.awaitingBuyTileId = 255;
  }
}
