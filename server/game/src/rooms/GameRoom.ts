import { Room, Client } from "colyseus";
import { GameState, Player, PropertyState } from "../schema/GameState";
import {
  GAME_CONFIG, Phase, ClientMsg, ServerMsg, TileType,
  CardEffect, drawCard, AUCTION_STEPS, type Card,
} from "@monopoly/shared";
import {
  canStart, pushRateWindow, computeMove, isPurchasable, rentFor, isDouble,
  jailRollOutcome, moveToTile, nextAlivePlayerId, resolveWinner, tileAt,
  mortgageValue, unmortgageCost, canBuildHouse, canSellHouse, validateTrade,
  type PropsMap, type TradeTerms,
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
  private auctionTimer?: any;
  private tradeTimer?: any;
  private botTimer?: any;
  private botSeq = 0; // счётчик для генерации id/имён ботов
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

    this.onMessage(ClientMsg.AddBot, (client) => {
      if (this.rateLimited(client)) return;
      this.handleAddBot(client);
    });
    this.onMessage(ClientMsg.RemoveBot, (client, msg: { botId?: string }) => {
      if (this.rateLimited(client)) return;
      this.handleRemoveBot(client, String(msg?.botId || ""));
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

    this.onMessage(ClientMsg.AuctionBid, (client, msg: { amount?: number }) => {
      if (this.rateLimited(client)) return;
      this.handleAuctionBid(client, Number(msg?.amount));
    });
    this.onMessage(ClientMsg.AuctionPass, (client) => {
      if (this.rateLimited(client)) return;
      this.handleAuctionPass(client);
    });

    this.onMessage(ClientMsg.ProposeTrade, (client, msg: any) => {
      if (this.rateLimited(client)) return;
      this.handleProposeTrade(client, msg);
    });
    this.onMessage(ClientMsg.AcceptTrade, (client) => {
      if (this.rateLimited(client)) return;
      this.handleAcceptTrade(client);
    });
    this.onMessage(ClientMsg.DeclineTrade, (client) => {
      if (this.rateLimited(client)) return;
      this.handleDeclineTrade(client);
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
    // Ушедший участвовал в обмене — снимаем предложение. Если ушёл получатель,
    // а предложивший (текущий игрок) остаётся — вернуть ему таймер хода (он был
    // на паузе на время обмена), иначе ход зависнет.
    if (this.state.trade.fromId &&
        (this.state.trade.fromId === sessionId || this.state.trade.toId === sessionId)) {
      const proposerId = this.state.trade.fromId;
      this.clearTrade();
      if (proposerId !== sessionId && this.state.phase === Phase.Playing &&
          this.state.currentPlayerId === proposerId) {
        this.startTurnTimer();
      }
    }
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
    // если ушедший участвовал в аукционе — убираем и, возможно, завершаем.
    if (this.state.auctionTileId !== 255) {
      const i = this.state.auctionBidders.indexOf(sessionId);
      if (i >= 0) this.state.auctionBidders.splice(i, 1);
      if (this.state.auctionBidderId === sessionId) { this.state.auctionBidderId = ""; this.state.auctionBid = 0; }
      if (this.state.auctionBidders.length <= 1) this.finishAuction();
    }
  }

  private setPhase(phase: Phase) {
    this.state.phase = phase;
    if (phase !== Phase.Playing && this.botTimer) { this.botTimer.clear(); this.botTimer = undefined; }
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

  // ── Боты в лобби (Фаза 5): хост добавляет/убирает ботов-соперников ──
  private botCount(): number {
    let n = 0;
    this.state.players.forEach((p) => { if (p.isBot) n++; });
    return n;
  }

  // Боты занимают слоты, но не клиентские подключения. Ограничиваем число живых
  // подключений так, чтобы всего игроков (люди+боты) не превышало maxPlayers.
  private updateBotCapacity() {
    this.maxClients = Math.max(1, this.state.maxPlayers - this.botCount());
  }

  private handleAddBot(client: Client) {
    if (client.sessionId !== this.state.hostId) return;
    if (this.state.phase !== Phase.Lobby) return;
    if (this.state.players.size >= this.state.maxPlayers) return;
    this.botSeq++;
    const b = new Player();
    b.id = `bot_${this.botSeq}_${Math.random().toString(36).slice(2, 6)}`;
    b.name = `Бот ${this.botSeq}`;
    b.avatar = "🤖";
    b.isBot = true;
    b.ready = true;      // боты всегда готовы
    b.connected = true;
    this.state.players.set(b.id, b);
    this.updateBotCapacity();
    console.log(`[room ${this.roomId}] +бот ${b.name} (${this.state.players.size} в комнате)`);
  }

  private handleRemoveBot(client: Client, botId: string) {
    if (client.sessionId !== this.state.hostId) return;
    if (this.state.phase !== Phase.Lobby) return;
    const b = this.state.players.get(botId);
    if (!b || !b.isBot) return;
    this.state.players.delete(botId);
    this.updateBotCapacity();
  }

  private beginRound() {
    if (this.botTimer) { this.botTimer.clear(); this.botTimer = undefined; }
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
    this.clearAuction();
    this.clearTrade();
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
    this.maybeDriveBot(); // если ходит бот — он сам разыграет ход
  }

  private handleTurnTimeout() {
    if (this.state.phase !== Phase.Playing) return;
    this.state.awaitingBuyTileId = 255; // не успел решить — считаем отказом
    this.pendingResolution = null;
    this.advanceTurn();
  }

  private handleRollDice(client: Client) { this.doRoll(client.sessionId); }

  private doRoll(playerId: string) {
    if (this.state.phase !== Phase.Playing) return;
    if (playerId !== this.state.currentPlayerId) return;
    if (this.state.trade.fromId) return; // сначала заверши обмен
    if (this.state.awaitingBuyTileId !== 255) return; // сначала реши покупку
    const p = this.state.players.get(playerId);
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
    if (this.state.awaitingBuyTileId === 255 && this.state.auctionTileId === 255 && this.state.currentPlayerId === p.id) this.afterResolve(p);
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
    if (this.state.awaitingBuyTileId === 255 && this.state.auctionTileId === 255 && this.state.currentPlayerId === p.id) this.afterResolve(p);
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
        // хватает денег — предлагаем купить; не хватает — сразу на аукцион.
        if (p.money >= (tile.price || 0)) this.state.awaitingBuyTileId = tile.id;
        else this.startAuction(tile.id);
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

  private handleBuyProperty(client: Client) { this.doBuy(client.sessionId); }

  private doBuy(playerId: string) {
    if (this.state.phase !== Phase.Playing || playerId !== this.state.currentPlayerId) return;
    if (this.state.awaitingBuyTileId === 255) return;
    const p = this.state.players.get(playerId);
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

  private handleDeclineBuy(client: Client) { this.doDecline(client.sessionId); }

  private doDecline(playerId: string) {
    if (this.state.phase !== Phase.Playing || playerId !== this.state.currentPlayerId) return;
    if (this.state.awaitingBuyTileId === 255) return;
    const tileId = this.state.awaitingBuyTileId;
    this.state.awaitingBuyTileId = 255;
    this.startAuction(tileId); // отказавшийся тоже участвует в торгах
  }

  // В тюрьме до броска: заплатить штраф — выйти. Дальше игрок ещё бросает и ходит.
  private handlePayJailFine(client: Client) {
    if (this.state.phase !== Phase.Playing) return;
    if (client.sessionId !== this.state.currentPlayerId) return;
    if (this.state.trade.fromId) return; // сначала заверши обмен
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
    if (this.state.trade.fromId) return; // сначала заверши обмен
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
    if (this.state.trade.fromId) return null; // во время обмена управление активами заморожено
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

  // ── Аукцион (при отказе от покупки / нехватке денег) ──
  private startAuction(tileId: number) {
    if (this.turnTimer) { this.turnTimer.clear(); this.turnTimer = undefined; } // таймер хода на паузу
    this.state.auctionTileId = tileId;
    this.state.auctionBid = 0;
    this.state.auctionBidderId = "";
    this.state.auctionBidders.clear();
    for (const pl of this.state.players.values()) if (!pl.bankrupt) this.state.auctionBidders.push(pl.id);
    if (this.state.auctionBidders.length === 0) { this.finishAuction(); return; }
    this.resetAuctionTimer();
    this.maybeDriveBot(); // боты-участники начнут делать ставки
    console.log(`[room ${this.roomId}] аукцион: клетка ${tileId}, участников ${this.state.auctionBidders.length}`);
  }

  private resetAuctionTimer() {
    if (this.auctionTimer) { this.auctionTimer.clear(); this.auctionTimer = undefined; }
    // Секунды, а не мс: эпоха в мс не влезает в uint32 (переполнение → таймер «0с»).
    this.state.auctionDeadline = Math.floor((Date.now() + GAME_CONFIG.auctionMs) / 1000);
    this.auctionTimer = this.clock.setTimeout(() => this.finishAuction(), GAME_CONFIG.auctionMs);
  }

  private handleAuctionBid(client: Client, amount: number) { this.doAuctionBid(client.sessionId, amount); }

  private doAuctionBid(playerId: string, amount: number) {
    if (this.state.phase !== Phase.Playing || this.state.auctionTileId === 255) return;
    const p = this.state.players.get(playerId);
    if (!p || p.bankrupt) return;
    if (this.state.auctionBidders.indexOf(p.id) < 0) return; // уже вышел из торгов
    if (!Number.isFinite(amount) || amount <= this.state.auctionBid || amount > p.money) return;
    this.state.auctionBid = Math.floor(amount);
    this.state.auctionBidderId = p.id;
    this.resetAuctionTimer();
    this.maybeDriveBot(); // дать ботам-участникам среагировать на новую ставку
  }

  private handleAuctionPass(client: Client) { this.doAuctionPass(client.sessionId); }

  private doAuctionPass(playerId: string) {
    if (this.state.phase !== Phase.Playing || this.state.auctionTileId === 255) return;
    const i = this.state.auctionBidders.indexOf(playerId);
    if (i < 0) return;
    this.state.auctionBidders.splice(i, 1);
    // остался один участник (обычно лидер) или ноль — завершаем.
    if (this.state.auctionBidders.length <= 1) this.finishAuction();
    else this.maybeDriveBot();
  }

  private finishAuction() {
    const tileId = this.state.auctionTileId;
    if (tileId === 255) return;
    const bidderId = this.state.auctionBidderId;
    const bid = this.state.auctionBid;
    const resumeId = this.state.currentPlayerId;

    if (bidderId && bid > 0) {
      const winner = this.state.players.get(bidderId);
      if (winner && !winner.bankrupt && winner.money >= bid) {
        winner.money -= bid;
        let prop = this.state.properties.get(String(tileId));
        if (!prop) { prop = new PropertyState(); this.state.properties.set(String(tileId), prop); }
        prop.ownerId = winner.id;
        console.log(`[room ${this.roomId}] аукцион: ${winner.name} выиграл клетку ${tileId} за ${bid}`);
      }
    }
    this.clearAuction();
    // возобновляем прерванный ход того, кто попал на клетку.
    const p = this.state.players.get(resumeId);
    if (p && this.state.phase === Phase.Playing) this.afterResolve(p);
  }

  private clearAuction() {
    if (this.auctionTimer) { this.auctionTimer.clear(); this.auctionTimer = undefined; }
    this.state.auctionTileId = 255;
    this.state.auctionBid = 0;
    this.state.auctionBidderId = "";
    this.state.auctionBidders.clear();
    this.state.auctionDeadline = 0;
  }

  // ── Обмен между игроками (Фаза 4) ──
  // Предложить можно только в свой ход ДО броска (простое окно без гонок с
  // авто-передачей хода). На время обмена таймер хода на паузе.
  private sanitizeTradeIds(raw: any): number[] {
    if (!Array.isArray(raw)) return [];
    const out: number[] = [];
    for (const v of raw) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n < 40 && !out.includes(n)) out.push(n);
      if (out.length >= 40) break;
    }
    return out;
  }

  private handleProposeTrade(client: Client, msg: any) {
    if (this.state.phase !== Phase.Playing) return;
    if (client.sessionId !== this.state.currentPlayerId) return;
    if (this.state.dice1 || this.state.dice2) return;      // только до броска
    if (this.state.awaitingBuyTileId !== 255) return;
    if (this.state.auctionTileId !== 255) return;
    if (this.state.trade.fromId) return;                    // уже есть активное предложение
    const from = this.state.players.get(client.sessionId);
    if (!from || from.bankrupt) return;
    const toId = String(msg?.toId || "");
    const to = this.state.players.get(toId);
    if (!to || to.bankrupt || to.id === from.id) return;

    const terms: TradeTerms = {
      fromId: from.id, toId: to.id,
      offerProps: this.sanitizeTradeIds(msg?.offerProps),
      requestProps: this.sanitizeTradeIds(msg?.requestProps),
      offerMoney: Math.floor(Number(msg?.offerMoney) || 0),
      requestMoney: Math.floor(Number(msg?.requestMoney) || 0),
      offerCards: Math.floor(Number(msg?.offerCards) || 0),
      requestCards: Math.floor(Number(msg?.requestCards) || 0),
    };
    if (!validateTrade(terms, this.propsView(), from.money, to.money, from.getOutCards, to.getOutCards)) return;

    const tr = this.state.trade;
    tr.fromId = terms.fromId;
    tr.toId = terms.toId;
    tr.offerProps.clear(); terms.offerProps.forEach((id) => tr.offerProps.push(id));
    tr.requestProps.clear(); terms.requestProps.forEach((id) => tr.requestProps.push(id));
    tr.offerMoney = terms.offerMoney;
    tr.requestMoney = terms.requestMoney;
    tr.offerCards = terms.offerCards;
    tr.requestCards = terms.requestCards;

    if (this.turnTimer) { this.turnTimer.clear(); this.turnTimer = undefined; } // таймер хода на паузу
    tr.deadline = Math.floor((Date.now() + GAME_CONFIG.tradeMs) / 1000);         // сек, не мс (uint32)
    this.tradeTimer = this.clock.setTimeout(() => this.resolveTrade(false), GAME_CONFIG.tradeMs);
    this.maybeDriveBot(); // если получатель — бот, он решит по эвристике
    console.log(`[room ${this.roomId}] обмен: ${from.name} → ${to.name}`);
  }

  private handleAcceptTrade(client: Client) { this.doAcceptTrade(client.sessionId); }

  private doAcceptTrade(playerId: string) {
    const tr = this.state.trade;
    if (!tr.fromId || playerId !== tr.toId) return; // принимает только получатель
    this.resolveTrade(true);
  }

  private handleDeclineTrade(client: Client) { this.doDeclineTrade(client.sessionId); }

  private doDeclineTrade(playerId: string) {
    const tr = this.state.trade;
    if (!tr.fromId) return;
    if (playerId !== tr.toId && playerId !== tr.fromId) return; // отклонить/отменить
    this.resolveTrade(false);
  }

  // Завершение обмена. accepted=true — исполняем (с повторной валидацией),
  // иначе просто снимаем предложение. В любом случае возобновляем ход предлагавшего.
  private resolveTrade(accepted: boolean) {
    const tr = this.state.trade;
    if (!tr.fromId) return;
    const fromId = tr.fromId, toId = tr.toId;
    const from = this.state.players.get(fromId);
    const to = this.state.players.get(toId);
    let done = false;

    if (accepted && from && to && !from.bankrupt && !to.bankrupt) {
      const terms: TradeTerms = {
        fromId, toId,
        offerProps: [...tr.offerProps], requestProps: [...tr.requestProps],
        offerMoney: tr.offerMoney, requestMoney: tr.requestMoney,
        offerCards: tr.offerCards, requestCards: tr.requestCards,
      };
      if (validateTrade(terms, this.propsView(), from.money, to.money, from.getOutCards, to.getOutCards)) {
        from.money += terms.requestMoney - terms.offerMoney; // нетто по деньгам
        to.money += terms.offerMoney - terms.requestMoney;
        from.getOutCards += terms.requestCards - terms.offerCards;
        to.getOutCards += terms.offerCards - terms.requestCards;
        for (const id of terms.offerProps) { const pr = this.state.properties.get(String(id)); if (pr) pr.ownerId = toId; }
        for (const id of terms.requestProps) { const pr = this.state.properties.get(String(id)); if (pr) pr.ownerId = fromId; }
        done = true;
        console.log(`[room ${this.roomId}] обмен принят: ${from.name} ↔ ${to.name}`);
      }
    }

    this.clearTrade();
    this.broadcast(ServerMsg.TradeResolved, { fromId, toId, accepted: done });
    // возобновляем ход предлагавшего — таймер хода был на паузе.
    if (this.state.phase === Phase.Playing && this.state.currentPlayerId) this.startTurnTimer();
  }

  private clearTrade() {
    if (this.tradeTimer) { this.tradeTimer.clear(); this.tradeTimer = undefined; }
    const tr = this.state.trade;
    tr.fromId = "";
    tr.toId = "";
    tr.offerProps.clear();
    tr.requestProps.clear();
    tr.offerMoney = 0;
    tr.requestMoney = 0;
    tr.offerCards = 0;
    tr.requestCards = 0;
    tr.deadline = 0;
  }

  // ── Боты-соперники (Фаза 5): сервер сам разыгрывает действия бота ──
  private isBot(id: string): boolean {
    return !!this.state.players.get(id)?.isBot;
  }

  // Определяет, требуется ли сейчас действие бота, и планирует его с задержкой,
  // чтобы люди успевали видеть ход. После действия цепочка продолжается.
  private maybeDriveBot() {
    if (this.botTimer) { this.botTimer.clear(); this.botTimer = undefined; }
    if (this.state.phase !== Phase.Playing) return;
    const action = this.pickBotAction();
    if (!action) return;
    this.botTimer = this.clock.setTimeout(() => {
      this.botTimer = undefined;
      if (this.state.phase !== Phase.Playing) return;
      action();
      this.maybeDriveBot(); // следующий шаг (докупка / повторный бросок на дубле / след. ставка)
    }, GAME_CONFIG.botDelayMs);
  }

  private pickBotAction(): (() => void) | null {
    const s = this.state;
    // Обмен: получатель-бот решает по эвристике ценности.
    if (s.trade.fromId && this.isBot(s.trade.toId)) {
      const id = s.trade.toId;
      return () => this.botResolveTrade(id);
    }
    // Аукцион: очередной бот-участник (не текущий лидер) делает ставку/пас.
    if (s.auctionTileId !== 255) {
      const id = [...s.auctionBidders].find((x) => this.isBot(x) && x !== s.auctionBidderId);
      return id ? () => this.botAuction(id) : null;
    }
    // Ход бота: решение о покупке, либо бросок кубиков.
    const cur = s.currentPlayerId;
    if (!this.isBot(cur)) return null;
    const p = s.players.get(cur);
    if (!p || p.bankrupt) return null;
    if (s.awaitingBuyTileId !== 255) return () => this.botBuyDecision(cur);
    if (s.dice1 === 0 && s.dice2 === 0) return () => this.doRoll(cur);
    return null;
  }

  // Покупает участок, если после покупки останется денежный резерв; иначе отказ (→ аукцион).
  private botBuyDecision(id: string) {
    const p = this.state.players.get(id);
    const price = tileAt(this.state.awaitingBuyTileId).price || 0;
    if (p && price > 0 && p.money - price >= GAME_CONFIG.botBuyReserve) this.doBuy(id);
    else this.doDecline(id);
  }

  // На аукционе поднимает ставку на один шаг, пока не превысит номинал/бюджет; иначе пас.
  private botAuction(id: string) {
    const s = this.state;
    if (s.auctionTileId === 255 || s.auctionBidders.indexOf(id) < 0) return;
    const bot = s.players.get(id);
    if (!bot) return;
    const budget = Math.min(bot.money, tileAt(s.auctionTileId).price || 0); // не платить выше номинала
    const next = s.auctionBid + AUCTION_STEPS[0];
    if (s.auctionBidderId !== id && next <= budget) this.doAuctionBid(id, next);
    else this.doAuctionPass(id);
  }

  // Принимает обмен, если получаемое (по номиналам) не меньше отдаваемого и хватает денег.
  private botResolveTrade(id: string) {
    const tr = this.state.trade;
    const bot = this.state.players.get(id);
    const val = (ids: number[]) => ids.reduce((sum, x) => sum + (tileAt(x).price || 0), 0);
    const receive = val([...tr.offerProps]) + tr.offerMoney + tr.offerCards * GAME_CONFIG.jailFine;
    const give = val([...tr.requestProps]) + tr.requestMoney + tr.requestCards * GAME_CONFIG.jailFine;
    if (bot && bot.money >= tr.requestMoney && receive >= give) this.doAcceptTrade(id);
    else this.doDeclineTrade(id);
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
