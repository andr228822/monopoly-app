import { useEffect, useRef, useState } from "react";
import { BOARD, TileType } from "@monopoly/shared";
import type { PlayerView, MoveEvent, RollEvent, TurnStartEvent } from "./net/useGame";
import { gridPos } from "./boardLayout";
import { Tokens } from "./Tokens";
import { Dice, DICE_ANIMATION_MS } from "./Dice";

const PLAYER_COLORS = ["#e63946", "#457b9d", "#f4a261", "#2a9d8f", "#e9c46a", "#9d4edd"];

const GROUP_COLORS: Record<string, string> = {
  brown: "#8b5a2b", lightblue: "#7ec8e3", pink: "#e75480", orange: "#f4a261",
  red: "#e63946", yellow: "#f9d342", green: "#2a9d8f", darkblue: "#1d3557",
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
// 4 угла доски (внутри кольца клеток) — кубики каждый бросок приземляются в
// двух РАЗНЫХ углах, чтобы не падать рядом друг с другом.
const DICE_QUADRANTS = [
  () => ({ left: rand(14, 33), top: rand(14, 33) }),
  () => ({ left: rand(67, 86), top: rand(14, 33) }),
  () => ({ left: rand(14, 33), top: rand(67, 86) }),
  () => ({ left: rand(67, 86), top: rand(67, 86) }),
];
function pickTwoQuadrants(): [{ left: number; top: number }, { left: number; top: number }] {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return [DICE_QUADRANTS[order[0]](), DICE_QUADRANTS[order[1]]()];
}

export function Board({
  players, properties, currentPlayerId, mySessionId,
  dice1, dice2, awaitingBuyTileId, phase, winnerId, lastRoll, lastMove, lastTurnStart,
  onRoll, onBuy, onDecline,
}: {
  players: PlayerView[];
  properties: Record<number, string>;
  currentPlayerId: string;
  mySessionId: string;
  dice1: number;
  dice2: number;
  awaitingBuyTileId: number;
  phase: string;
  winnerId: string;
  lastRoll: RollEvent | null;
  lastMove: MoveEvent | null;
  lastTurnStart: TurnStartEvent | null;
  onRoll: () => void;
  onBuy: () => void;
  onDecline: () => void;
}) {
  const colorOf = (playerId: string) => PLAYER_COLORS[players.findIndex((p) => p.id === playerId) % PLAYER_COLORS.length];
  const isMyTurn = currentPlayerId === mySessionId;
  const awaitingTile = awaitingBuyTileId !== 255 ? BOARD[awaitingBuyTileId] : null;
  const rolled = dice1 > 0 || dice2 > 0;

  // Секундомер хода — тикаем раз в полсекунды, пока идёт партия.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== "playing") return;
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, [phase]);
  const secondsLeft = lastTurnStart && lastTurnStart.playerId === currentPlayerId
    ? Math.max(0, Math.ceil((lastTurnStart.deadline - now) / 1000))
    : null;

  // Новый бросок — разбрасываем кубики по двум разным углам доски.
  const [dicePos, setDicePos] = useState(() => pickTwoQuadrants());
  const lastPosTs = useRef(0);
  useEffect(() => {
    if (!lastRoll || lastRoll.ts === lastPosTs.current) return;
    lastPosTs.current = lastRoll.ts;
    setDicePos(pickTwoQuadrants());
  }, [lastRoll]);

  return (
    <div className="board">
      {BOARD.map((tile) => {
        const { col, row } = gridPos(tile.id);
        const ownerId = properties[tile.id];
        return (
          <div
            key={tile.id}
            className="tile"
            style={{
              gridColumn: col,
              gridRow: row,
              borderColor: ownerId ? colorOf(ownerId) : undefined,
              borderWidth: ownerId ? 3 : 1,
            }}
          >
            {tile.group && <div className="tileGroup" style={{ background: GROUP_COLORS[tile.group] }} />}
            <div className="tileName">{tile.name}</div>
            {tile.price ? <div className="tilePrice">${tile.price}</div> : null}
            {tile.tax ? <div className="tilePrice">${tile.tax}</div> : null}
          </div>
        );
      })}

      <Tokens players={players} colorOf={colorOf} moveEvent={lastMove} startDelayMs={DICE_ANIMATION_MS} />

      {/* Кубики — оверлей поверх всей доски, каждый бросок разлетаются по разным углам.
          Значение берём из самого события броска (lastRoll), НЕ из dice1/dice2: синк
          состояния и это сообщение идут отдельными пакетами и могут прийти в любом
          порядке — стейт иногда ещё старый в момент броска. */}
      <Dice value={lastRoll?.d1 ?? 1} rollTs={lastRoll?.ts ?? 0} leftPct={dicePos[0].left} topPct={dicePos[0].top} />
      <Dice value={lastRoll?.d2 ?? 1} rollTs={lastRoll?.ts ?? 0} leftPct={dicePos[1].left} topPct={dicePos[1].top} />

      <div className="center">
        {phase === "game_over" ? (
          <p className="winner">🏆 Победил: {players.find((p) => p.id === winnerId)?.name || "никто"}</p>
        ) : (
          <>
            <p className="turn">
              {isMyTurn ? "Твой ход" : `Ходит: ${players.find((p) => p.id === currentPlayerId)?.name || "…"}`}
              {secondsLeft !== null && <span className="timer"> ⏱ {secondsLeft}с</span>}
            </p>
            {rolled && lastRoll?.isDouble && <p className="doubleBadge">🎲 Дубль! Ещё бросок</p>}
            {isMyTurn && awaitingTile ? (
              <div className="buyBox">
                <p>Купить «{awaitingTile.name}» за ${awaitingTile.price}?</p>
                <button onClick={onBuy}>Купить</button>
                <button onClick={onDecline}>Не покупать</button>
              </div>
            ) : isMyTurn && !rolled ? (
              <div className="buyBox">
                <button onClick={onRoll}>🎲 Бросить кубики</button>
              </div>
            ) : isMyTurn ? (
              <p className="note">Ход завершится автоматически…</p>
            ) : null}
          </>
        )}
        <ul className="players">
          {players.map((p) => (
            <li key={p.id} style={{ color: colorOf(p.id) }}>
              {p.name} — ${p.money} {p.bankrupt ? "💀" : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
