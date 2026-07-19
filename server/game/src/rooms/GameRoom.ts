import { Room, Client } from "colyseus";
import { GameState, Player } from "../schema/GameState";
import { GAME_CONFIG, Phase, ClientMsg, ServerMsg } from "@monopoly/shared";
import { canStart, pushRateWindow } from "../logic";

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
    this.clock.setTimeout(() => this.setPhase(Phase.Playing), GAME_CONFIG.countdownMs);
  }
}
