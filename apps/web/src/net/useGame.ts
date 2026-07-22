import { useCallback, useEffect, useRef, useState } from "react";
import { Client, Room } from "colyseus.js";
import { ClientMsg, ServerMsg, Phase } from "@monopoly/shared";
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
  inJail: boolean;
  getOutCards: number;
}

export interface PropView { ownerId: string; houses: number; mortgaged: boolean }

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
  properties: Record<number, PropView>; // tileId -> владение (владелец/дома/залог)
  winnerId: string;
  auctionTileId: number;   // 255 = нет аукциона
  auctionBid: number;
  auctionBidderId: string;
  auctionBidders: string[];
  auctionDeadline: number;
}

export type Status = "idle" | "connecting" | "connected" | "error";

// Разовые события для анимации (бросок/движение) — отдельно от синка состояния,
// чтобы клиент мог проиграть анимацию, а не просто мгновенно отразить конечные значения.
export interface RollEvent { playerId: string; d1: number; d2: number; isDouble: boolean; ts: number }
export interface MoveEvent { playerId: string; from: number; to: number; passedGo: boolean; direct?: boolean; ts: number }
export interface TurnStartEvent { playerId: string; deadline: number; ts: number }
export interface CardEvent { playerId: string; deck: "chance" | "chest"; text: string; ts: number }

const EMPTY: GameSnapshot = {
  phase: Phase.Lobby, lobbyName: "", code: "", maxPlayers: 6, hostId: "", players: [],
  currentPlayerId: "", dice1: 0, dice2: 0, awaitingBuyTileId: 255, properties: {}, winnerId: "",
  auctionTileId: 255, auctionBid: 0, auctionBidderId: "", auctionBidders: [], auctionDeadline: 0,
};

// Хук подключения к игровому серверу. Зеркалит состояние комнаты в React.
export function useGame() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<GameSnapshot>(EMPTY);
  const [mySessionId, setMySessionId] = useState("");
  const [lastRoll, setLastRoll] = useState<RollEvent | null>(null);
  const [lastMove, setLastMove] = useState<MoveEvent | null>(null);
  const [lastTurnStart, setLastTurnStart] = useState<TurnStartEvent | null>(null);
  const [lastCard, setLastCard] = useState<CardEvent | null>(null);
  const roomRef = useRef<Room | null>(null);
  const clientRef = useRef<Client | null>(null);
  const attachedRoomId = useRef<string | null>(null);

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
        inJail: p.inJail ?? false, getOutCards: p.getOutCards ?? 0,
      });
    });
    const properties: Record<number, PropView> = {};
    state.properties?.forEach((prop: any, tileId: string) => {
      if (prop.ownerId) properties[Number(tileId)] = { ownerId: prop.ownerId, houses: prop.houses ?? 0, mortgaged: prop.mortgaged ?? false };
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
      auctionTileId: state.auctionTileId ?? 255,
      auctionBid: state.auctionBid ?? 0,
      auctionBidderId: state.auctionBidderId ?? "",
      auctionBidders: state.auctionBidders ? [...state.auctionBidders] : [],
      auctionDeadline: state.auctionDeadline ?? 0,
    });
  }, []);

  const attach = useCallback((room: Room) => {
    // Защита от повторной регистрации обработчиков на ту же комнату (иначе каждое
    // сообщение сервера обрабатывается дважды — например, фишка дважды проходит путь).
    if (attachedRoomId.current === room.roomId) return;
    attachedRoomId.current = room.roomId;
    roomRef.current = room;
    setMySessionId(room.sessionId);
    room.onStateChange(() => syncFromRoom(room));
    room.onMessage(ServerMsg.DiceRolled, (m: { playerId: string; d1: number; d2: number; isDouble: boolean }) => {
      setLastRoll({ ...m, ts: Date.now() });
    });
    room.onMessage(ServerMsg.PlayerMoved, (m: { playerId: string; from: number; to: number; passedGo: boolean; direct?: boolean }) => {
      setLastMove({ ...m, ts: Date.now() });
    });
    room.onMessage(ServerMsg.TurnStarted, (m: { playerId: string; deadline: number }) => {
      setLastTurnStart({ ...m, ts: Date.now() });
    });
    room.onMessage(ServerMsg.CardDrawn, (m: { playerId: string; deck: "chance" | "chest"; text: string }) => {
      setLastCard({ ...m, ts: Date.now() });
    });
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
  const payJailFine = useCallback(() => {
    roomRef.current?.send(ClientMsg.PayJailFine);
  }, []);
  const useJailCard = useCallback(() => {
    roomRef.current?.send(ClientMsg.UseJailCard);
  }, []);
  const mortgage = useCallback((tileId: number) => {
    roomRef.current?.send(ClientMsg.MortgageProperty, { tileId });
  }, []);
  const unmortgage = useCallback((tileId: number) => {
    roomRef.current?.send(ClientMsg.Unmortgage, { tileId });
  }, []);
  const buildHouse = useCallback((tileId: number) => {
    roomRef.current?.send(ClientMsg.BuildHouse, { tileId });
  }, []);
  const sellHouse = useCallback((tileId: number) => {
    roomRef.current?.send(ClientMsg.SellHouse, { tileId });
  }, []);
  const auctionBid = useCallback((amount: number) => {
    roomRef.current?.send(ClientMsg.AuctionBid, { amount });
  }, []);
  const auctionPass = useCallback(() => {
    roomRef.current?.send(ClientMsg.AuctionPass);
  }, []);

  const leave = useCallback(() => {
    try { roomRef.current?.leave(); } catch {}
    roomRef.current = null;
    setStatus("idle");
    setSnapshot(EMPTY);
  }, []);

  useEffect(() => () => { try { roomRef.current?.leave(); } catch {} }, []);

  return {
    status, error, snapshot, mySessionId, lastRoll, lastMove, lastTurnStart, lastCard,
    createGame, joinByCode, setReady, startGame,
    rollDice, buyProperty, declineBuy, payJailFine, useJailCard,
    mortgage, unmortgage, buildHouse, sellHouse, auctionBid, auctionPass,
    leave,
  };
}
