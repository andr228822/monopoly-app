import { useCallback, useEffect, useRef, useState } from "react";
import { Client, Room } from "colyseus.js";
import { ClientMsg, Phase } from "@monopoly/shared";
import { SERVER_ENDPOINT, TOKEN_BASE } from "./config";

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  ready: boolean;
  connected: boolean;
  money: number;
  position: number;
  bankrupt: boolean;
}

export interface GameSnapshot {
  phase: string;
  lobbyName: string;
  code: string;
  maxPlayers: number;
  hostId: string;
  players: PlayerView[];
  currentPlayerId: string;
  dice1: number;
  dice2: number;
  awaitingBuyTileId: number;
  properties: Record<number, string>; // tileId -> ownerId
  winnerId: string;
}

export type Status = "idle" | "connecting" | "connected" | "error";

const EMPTY: GameSnapshot = {
  phase: Phase.Lobby, lobbyName: "", code: "", maxPlayers: 6, hostId: "", players: [],
  currentPlayerId: "", dice1: 0, dice2: 0, awaitingBuyTileId: 255, properties: {}, winnerId: "",
};

// Хук подключения к игровому серверу. Зеркалит состояние комнаты в React.
export function useGame() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<GameSnapshot>(EMPTY);
  const [mySessionId, setMySessionId] = useState("");
  const roomRef = useRef<Room | null>(null);
  const clientRef = useRef<Client | null>(null);

  const getClient = useCallback(() => {
    if (!clientRef.current) clientRef.current = new Client(SERVER_ENDPOINT);
    return clientRef.current;
  }, []);

  const syncFromRoom = useCallback((room: Room) => {
    const state: any = room.state;
    const players: PlayerView[] = [];
    state.players?.forEach((p: any) => {
      players.push({
        id: p.id, name: p.name, avatar: p.avatar ?? "", ready: p.ready, connected: p.connected ?? true,
        money: p.money ?? 0, position: p.position ?? 0, bankrupt: p.bankrupt ?? false,
      });
    });
    const properties: Record<number, string> = {};
    state.properties?.forEach((prop: any, tileId: string) => {
      if (prop.ownerId) properties[Number(tileId)] = prop.ownerId;
    });
    setSnapshot({
      phase: state.phase,
      lobbyName: state.lobbyName,
      code: state.code,
      maxPlayers: state.maxPlayers,
      hostId: state.hostId,
      players,
      currentPlayerId: state.currentPlayerId ?? "",
      dice1: state.dice1 ?? 0,
      dice2: state.dice2 ?? 0,
      awaitingBuyTileId: state.awaitingBuyTileId ?? 255,
      properties,
      winnerId: state.winnerId ?? "",
    });
  }, []);

  const attach = useCallback((room: Room) => {
    roomRef.current = room;
    setMySessionId(room.sessionId);
    room.onStateChange(() => syncFromRoom(room));
    room.onLeave(() => {
      roomRef.current = null;
      setStatus("idle");
      setSnapshot(EMPTY);
    });
    room.onError((code, message) => setError(message || `error ${code}`));
    setStatus("connected");
  }, [syncFromRoom]);

  const run = useCallback(async (fn: () => Promise<Room>) => {
    try {
      setStatus("connecting");
      setError("");
      attach(await fn());
    } catch (e: any) {
      setError(e?.message || "ошибка подключения");
      setStatus("error");
    }
  }, [attach]);

  const createGame = useCallback((name: string, lobbyName: string, isPrivate: boolean) =>
    run(() => getClient().create("game", { name, lobbyName, isPrivate })), [run, getClient]);

  const joinByCode = useCallback((code: string, name: string) =>
    run(async () => {
      const res = await fetch(`${TOKEN_BASE}/rooms/by-code?code=${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error("лобби с таким кодом не найдено");
      const { roomId } = await res.json();
      return getClient().joinById(roomId, { name });
    }), [run, getClient]);

  const setReady = useCallback((ready: boolean) => {
    roomRef.current?.send(ClientMsg.SetReady, { ready });
  }, []);

  const startGame = useCallback(() => {
    roomRef.current?.send(ClientMsg.StartGame);
  }, []);

  const rollDice = useCallback(() => {
    roomRef.current?.send(ClientMsg.RollDice);
  }, []);
  const buyProperty = useCallback(() => {
    roomRef.current?.send(ClientMsg.BuyProperty);
  }, []);
  const declineBuy = useCallback(() => {
    roomRef.current?.send(ClientMsg.DeclineBuy);
  }, []);
  const endTurn = useCallback(() => {
    roomRef.current?.send(ClientMsg.EndTurn);
  }, []);

  const leave = useCallback(() => {
    try { roomRef.current?.leave(); } catch {}
    roomRef.current = null;
    setStatus("idle");
    setSnapshot(EMPTY);
  }, []);

  useEffect(() => () => { try { roomRef.current?.leave(); } catch {} }, []);

  return {
    status, error, snapshot, mySessionId,
    createGame, joinByCode, setReady, startGame,
    rollDice, buyProperty, declineBuy, endTurn,
    leave,
  };
}
