import { Room, Client } from "colyseus";
import { GameState, Player, PropertyState } from "../schema/GameState";
import {
  GAME_CONFIG, Phase, ClientMsg, ServerMsg, TileType,
  CardEffect, drawCard, type Card,
} from "@monopoly/shared";
import {
  canStart, pushRateWindow, computeMove, isPurchasable, rentFor, isDouble,
  jailRollOutcome, moveToTile, nextAlivePlayerId, resolveWinner, tileAt,
  mortgageValue, unmortgageCost, canBuildHouse, canSellHouse, type PropsMap,
} from "../logic";

interface CreateOptions {
  lobbyName?: string;
  isPrivate?: boolean;
  maxPlayers?: number;
  code?: string;
  turnMs?: number; // только для тестов — укоротить лимит хода
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
  private turnMs: number = GAME_CONFIG.turnMs;
  private turnTimer?: any;
  private turnDoubles = 0; // подряд выпавших дублей у текущего игрока в этом ходу
  // Что делать после разрешения клетки (может ждать решения о покупке — см. afterResolve).
  private pendingResolution: "advance" | "reroll" | null = null;

  onCreate(options: CreateOptions = {}) {
    this.setState(new GameState());
    this.state.lobbyName = (options.lobbyName || "Лобби").slice(0, 24);
    this.maxClients = Math.min(Math.max(options.maxPlayers || 6, 2), GAME_CONFIG.maxPlayers);
    this.state.maxPlayers = this.maxClients;
    this.code = options.code || Math.random().toString(36).slice(2, 8).toUpperCase();
    this.state.code = this.code;
    if (options.isPrivate) this.setPrivate(true);
    if (options.turnMs) this.turnMs = Math.min(Math.max(options.turnMs, 200), GAME_CONFIG.turnMs);
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
      this.handleDeclineBuy(client);
    });

    this.onMessage(ClientMsg.PayJailFine, (client) => {
      if (this.rateLimited(client)) return;
      this.handlePayJailFine(client);
    });

    this.onMessage(ClientMsg.UseJailCard, (client) => {
      if (this.rateLimited(client)) return;
      this.handleUseJailCard(client);
    });

    this.onMessage(ClientMsg.MortgageProperty, (client, msg: { tileId?: number }) => {
      if (this.rateLimited(client)) return;
      this.handleMortgage(client, Number(msg?.tileId));
    });
    this.onMessage(ClientMsg.Unmortgage, (client, msg: { tileId?: number }) => {
      if (this.rateLimited(client)) return;
      this.handleUnmortgage(client, Number(msg?.tileId));
    });
    this.onMessage(ClientMsg.BuildHouse, (client, msg: { tileId?: number }) => {
      if (this.rateLimited(client)) return;
      this.handleBuildHouse(client, Number(msg?.tileId));
    });
    this.onMessage(ClientMsg.SellHouse, (client, msg: { tileId?: number }) => {
      if (this.rateLimited(client)) return;
      this.handleSellHouse(client, Number(msg?.tileId));
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
      p.inJail = false;
      p.jailTurns = 0;
      p.getOutCards = 0;
    }
    this.state.winnerId = "";
    this.state.dice1 = 0;
    this.state.dice2 = 0;
    this.state.awaitingBuyTileId = 255;
    this.state.currentPlayerId = this.turnOrder[0] || "";
    this.turnDoubles = 0;
    this.pendingResolution = null;
    this.setPhase(Phase.Playing);
    this.startTurnTimer();
  }

  // ── Таймер хода: 60с на весь ход (включая решение о покупке). Не успел — пропуск. ──
  private startTurnTimer() {
    if (this.turnTimer) { this.turnTimer.clear(); this.turnTimer = undefined; }
    if (!this.state.currentPlayerId) return;
    const deadline = Date.now() + this.turnMs;
    this.broadcast(ServerMsg.TurnStarted, { playerId: this.state.currentPlayerId, deadline });
    this.turnTimer = this.clock.setTimeout(() => this.handleTurnTimeout(), this.turnMs);
  }

  private handleTurnTimeout() {
    if (this.state.phase !== Phase.Playing) return;
    this.state.awaitingBuyTileId = 255; // не успел решить — считаем отказом
    this.pendingResolution = null;
    this.advanceTurn();
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
    const double = isDouble(d1, d2);
    this.broadcast(ServerMsg.DiceRolled, { playerId: p.id, d1, d2, isDouble: double });

    // ── Бросок в тюрьме — отдельная логика (дубль/штраф/попытки) ──
    if (p.inJail) { this.resolveJailRoll(p, d1, d2, double); return; }

    if (double) this.turnDoubles++;
    // 3 дубля подряд — сразу в тюрьму, без учёта клетки, куда указывали кубики.
    if (double && this.turnDoubles >= 3) {
      this.sendToJail(p);
      this.pendingResolution = null;
      this.scheduleResolution("advance", p.id);
      return;
    }

    this.pendingResolution = double ? "reroll" : "advance";
    const from = p.position;
    const { to, passedGo } = computeMove(p.position, d1, d2);
    this.movePlayer(p, from, to, passedGo);

    this.resolveTile(p, d1, d2);
    if (this.state.awaitingBuyTileId === 255 && this.state.currentPlayerId === p.id) this.afterResolve(p);
  }

  // Бросок кубиков, когда игрок в тюрьме: дубль → выход и ход этим броском;
  // иначе попытка засчитана — либо остаёмся, либо (исчерпав попытки) выходим со штрафом.
  private resolveJailRoll(p: Player, d1: number, d2: number, double: boolean) {
    p.jailTurns++;
    const outcome = jailRollOutcome(double, p.jailTurns);
    if (outcome === "stay") {
      this.pendingResolution = null;
      this.scheduleResolution("advance", p.id); // ход переходит дальше
      return;
    }
    if (outcome === "forced_pay") {
      this.chargeMoney(p, GAME_CONFIG.jailFine);
      if (p.bankrupt) return; // банкротство обработано (ход уже передан)
    }
    // escape или forced_pay → выходим и ходим на выпавший бросок (без доп. хода за дубль).
    p.inJail = false;
    p.jailTurns = 0;
    this.pendingResolution = "advance";
    const from = p.position;
    const { to, passedGo } = computeMove(p.position, d1, d2);
    this.movePlayer(p, from, to, passedGo);
    this.resolveTile(p, d1, d2);
    if (this.state.awaitingBuyTileId === 255 && this.state.currentPlayerId === p.id) this.afterResolve(p);
  }

  // Перемещение фишки: обновляет позицию, бонус за проход Старта, шлёт анимацию.
  private movePlayer(p: Player, from: number, to: number, passedGo: boolean, direct = false) {
    p.position = to;
    if (passedGo) p.money += GAME_CONFIG.passGoBonus;
    this.broadcast(ServerMsg.PlayerMoved, { playerId: p.id, from, to, passedGo, direct });
  }

  // Отправка в тюрьму: телепорт на клетку тюрьмы, без бонуса за Старт.
  private sendToJail(p: Player) {
    const from = p.position;
    p.inJail = true;
    p.jailTurns = 0;
    this.movePlayer(p, from, GAME_CONFIG.jailTileId, false, true);
  }

  // Срез владений для чистых функций расчёта аренды (logic.ts).
  private propsView(): PropsMap {
    const m: PropsMap = {};
    this.state.properties.forEach((prop, key) => {
      m[Number(key)] = { ownerId: prop.ownerId, houses: prop.houses, mortgaged: prop.mortgaged };
    });
    return m;
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
        if (owner && !owner.bankrupt) this.payRent(p, owner, rentFor(tile, this.propsView(), d1, d2), tile.id);
      }
    } else if (tile.type === TileType.Tax) {
      this.chargeMoney(p, tile.tax || 0);
    } else if (tile.type === TileType.GoToJail) {
      this.sendToJail(p);
      this.pendingResolution = "advance"; // попал в тюрьму — ход окончен, доп. хода нет
    } else if (tile.type === TileType.Chance) {
      this.drawAndApply(p, "chance", d1, d2);
    } else if (tile.type === TileType.Chest) {
      this.drawAndApply(p, "chest", d1, d2);
    }
    // go/jail(просто в гостях)/free_parking — без эффекта.
  }

  // Тянем карту, показываем всем, применяем эффект.
  private drawAndApply(p: Player, deck: "chance" | "chest", d1: number, d2: number) {
    const card = drawCard(deck);
    this.broadcast(ServerMsg.CardDrawn, { playerId: p.id, deck, text: card.text });
    this.applyCard(p, card, d1, d2);
  }

  private applyCard(p: Player, card: Card, d1: number, d2: number) {
    switch (card.effect) {
      case CardEffect.Money:
        this.changeMoney(p, card.amount || 0);
        break;
      case CardEffect.GetOutFree:
        p.getOutCards++;
        break;
      case CardEffect.GoToJail:
        this.sendToJail(p);
        this.pendingResolution = "advance";
        break;
      case CardEffect.MoveTo: {
        const { to, passedGo } = moveToTile(p.position, card.tile ?? p.position);
        this.movePlayer(p, p.position, to, passedGo);
        this.resolveTile(p, d1, d2); // новая клетка тоже отрабатывает (аренда/покупка/…)
        break;
      }
      case CardEffect.CollectFromEach: {
        const amount = card.amount || 0;
        for (const o of this.state.players.values()) {
          if (o.id === p.id || o.bankrupt) continue;
          o.money -= amount;
          p.money += amount;
          if (o.money < 0) this.bankruptPlayer(o);
          if (this.state.phase !== Phase.Playing) return;
        }
        break;
      }
      case CardEffect.PayEach: {
        const amount = card.amount || 0;
        for (const o of this.state.players.values()) {
          if (o.id === p.id || o.bankrupt) continue;
          o.money += amount;
          p.money -= amount;
        }
        if (p.money < 0) this.bankruptPlayer(p);
        break;
      }
    }
  }

  private payRent(payer: Player, owner: Player, amount: number, tileId: number) {
    payer.money -= amount;
    owner.money += amount;
    this.broadcast(ServerMsg.RentPaid, { fromId: payer.id, toId: owner.id, amount, tileId });
    if (payer.money < 0) this.bankruptPlayer(payer);
  }

  // Налог/штраф уходит в банк — просто теряются деньги, никому не зачисляются.
  private chargeMoney(p: Player, amount: number) {
    p.money -= amount;
    if (p.money < 0) this.bankruptPlayer(p);
  }

  // Изменение денег со знаком (карты): + начисление, − списание (может обанкротить).
  private changeMoney(p: Player, delta: number) {
    p.money += delta;
    if (p.money < 0) this.bankruptPlayer(p);
  }

  private bankruptPlayer(p: Player) {
    p.bankrupt = true;
    for (const prop of this.state.properties.values()) {
      if (prop.ownerId === p.id) { prop.ownerId = ""; prop.houses = 0; prop.mortgaged = false; } // банку
    }
    this.broadcast(ServerMsg.PlayerBankrupt, { playerId: p.id });

    const winner = resolveWinner([...this.state.players.values()]);
    if (winner !== null) {
      this.state.winnerId = winner;
      this.setPhase(Phase.GameOver);
      this.broadcast(ServerMsg.GameOver, { winnerId: winner });
      console.log(`[room ${this.roomId}] 🏆 Победитель: ${winner || "никто"}`);
    } else if (this.state.currentPlayerId === p.id) {
      this.pendingResolution = null;
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
    this.afterResolve(p);
  }

  private handleDeclineBuy(client: Client) {
    if (!this.isMyTurnWithPendingBuy(client)) return;
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    this.state.awaitingBuyTileId = 255;
    this.afterResolve(p);
  }

  // В тюрьме до броска: заплатить штраф — выйти. Дальше игрок ещё бросает и ходит.
  private handlePayJailFine(client: Client) {
    if (this.state.phase !== Phase.Playing) return;
    if (client.sessionId !== this.state.currentPlayerId) return;
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.inJail || p.money < GAME_CONFIG.jailFine) return;
    if (this.state.dice1 || this.state.dice2) return; // уже бросил в этот ход
    this.chargeMoney(p, GAME_CONFIG.jailFine);
    p.inJail = false;
    p.jailTurns = 0;
  }

  // В тюрьме до броска: использовать карту «выход бесплатно». Дальше бросок и ход.
  private handleUseJailCard(client: Client) {
    if (this.state.phase !== Phase.Playing) return;
    if (client.sessionId !== this.state.currentPlayerId) return;
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.inJail || p.getOutCards < 1) return;
    if (this.state.dice1 || this.state.dice2) return; // уже бросил в этот ход
    p.getOutCards--;
    p.inJail = false;
    p.jailTurns = 0;
  }

  // ── Ипотека и застройка (только в свой ход) ──
  private myTurnPlayer(client: Client): Player | null {
    if (this.state.phase !== Phase.Playing) return null;
    if (client.sessionId !== this.state.currentPlayerId) return null;
    const p = this.state.players.get(client.sessionId);
    return p && !p.bankrupt ? p : null;
  }

  private handleMortgage(client: Client, tileId: number) {
    const p = this.myTurnPlayer(client);
    if (!p) return;
    const prop = this.state.properties.get(String(tileId));
    const tile = tileAt(tileId);
    if (!prop || prop.ownerId !== p.id || prop.mortgaged || prop.houses > 0) return;
    prop.mortgaged = true;
    p.money += mortgageValue(tile.price || 0);
  }

  private handleUnmortgage(client: Client, tileId: number) {
    const p = this.myTurnPlayer(client);
    if (!p) return;
    const prop = this.state.properties.get(String(tileId));
    const tile = tileAt(tileId);
    if (!prop || prop.ownerId !== p.id || !prop.mortgaged) return;
    const cost = unmortgageCost(tile.price || 0);
    if (p.money < cost) return;
    p.money -= cost;
    prop.mortgaged = false;
  }

  private handleBuildHouse(client: Client, tileId: number) {
    const p = this.myTurnPlayer(client);
    if (!p) return;
    if (!canBuildHouse(this.propsView(), tileId, p.id)) return;
    const cost = tileAt(tileId).houseCost || 0;
    if (p.money < cost) return;
    const prop = this.state.properties.get(String(tileId));
    if (!prop) return;
    p.money -= cost;
    prop.houses += 1;
  }

  private handleSellHouse(client: Client, tileId: number) {
    const p = this.myTurnPlayer(client);
    if (!p) return;
    if (!canSellHouse(this.propsView(), tileId, p.id)) return;
    const prop = this.state.properties.get(String(tileId));
    if (!prop) return;
    prop.houses -= 1;
    p.money += Math.floor((tileAt(tileId).houseCost || 0) / 2); // продажа за полцены
  }

  // Клетка разрешена (и решение о покупке, если было, принято) — либо ещё один
  // бросок тому же игроку (дубль), либо ход переходит дальше. С паузой, чтобы
  // на клиенте успела доиграть анимация кубиков/движения.
  private afterResolve(p: Player) {
    const action = this.pendingResolution;
    this.pendingResolution = null;
    this.scheduleResolution(action === "reroll" ? "reroll" : "advance", p.id);
  }

  private scheduleResolution(action: "advance" | "reroll", playerId: string) {
    this.clock.setTimeout(() => {
      if (this.state.phase !== Phase.Playing) return;
      if (this.state.currentPlayerId !== playerId) return; // ход уже ушёл (например, банкротство)
      if (action === "reroll") this.continueTurn();
      else this.advanceTurn();
    }, GAME_CONFIG.resolveDelayMs);
  }

  // Игрок остаётся тем же (дубль) — просто разрешаем новый бросок.
  private continueTurn() {
    this.state.dice1 = 0;
    this.state.dice2 = 0;
    this.state.awaitingBuyTileId = 255;
    this.startTurnTimer();
  }

  private advanceTurn() {
    const bankruptIds = new Set(
      [...this.state.players.values()].filter((p) => p.bankrupt).map((p) => p.id)
    );
    this.state.currentPlayerId = nextAlivePlayerId(this.turnOrder, this.state.currentPlayerId, bankruptIds);
    this.state.dice1 = 0;
    this.state.dice2 = 0;
    this.state.awaitingBuyTileId = 255;
    this.turnDoubles = 0;
    this.startTurnTimer();
  }
}
