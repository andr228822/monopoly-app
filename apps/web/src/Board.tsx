import { BOARD, TileType } from "@monopoly/shared";
import type { PlayerView, MoveEvent, RollEvent } from "./net/useGame";
import { gridPos } from "./boardLayout";
import { Tokens } from "./Tokens";
import { Dice } from "./Dice";

const PLAYER_COLORS = ["#e63946", "#457b9d", "#f4a261", "#2a9d8f", "#e9c46a", "#9d4edd"];

const GROUP_COLORS: Record<string, string> = {
  brown: "#8b5a2b", lightblue: "#7ec8e3", pink: "#e75480", orange: "#f4a261",
  red: "#e63946", yellow: "#f9d342", green: "#2a9d8f", darkblue: "#1d3557",
};

export function Board({
  players, properties, currentPlayerId, mySessionId,
  dice1, dice2, awaitingBuyTileId, phase, winnerId, lastRoll, lastMove,
  onRoll, onBuy, onDecline, onEndTurn,
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
  onRoll: () => void;
  onBuy: () => void;
  onDecline: () => void;
  onEndTurn: () => void;
}) {
  const colorOf = (playerId: string) => PLAYER_COLORS[players.findIndex((p) => p.id === playerId) % PLAYER_COLORS.length];
  const isMyTurn = currentPlayerId === mySessionId;
  const awaitingTile = awaitingBuyTileId !== 255 ? BOARD[awaitingBuyTileId] : null;
  const rolled = dice1 > 0 || dice2 > 0;

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

      <Tokens players={players} colorOf={colorOf} moveEvent={lastMove} />

      <div className="center">
        {phase === "game_over" ? (
          <p className="winner">🏆 Победил: {players.find((p) => p.id === winnerId)?.name || "никто"}</p>
        ) : (
          <>
            <p className="turn">
              {isMyTurn ? "Твой ход" : `Ходит: ${players.find((p) => p.id === currentPlayerId)?.name || "…"}`}
            </p>
            <div className="diceRow">
              <Dice value={dice1 || 1} rollTs={lastRoll?.ts ?? 0} />
              <Dice value={dice2 || 1} rollTs={lastRoll?.ts ?? 0} />
            </div>
            {isMyTurn && awaitingTile ? (
              <div className="buyBox">
                <p>Купить «{awaitingTile.name}» за ${awaitingTile.price}?</p>
                <button onClick={onBuy}>Купить</button>
                <button onClick={onDecline}>Не покупать</button>
              </div>
            ) : isMyTurn ? (
              <div className="buyBox">
                <button onClick={onRoll} disabled={rolled}>🎲 Бросить кубики</button>
                <button onClick={onEndTurn} disabled={!rolled}>Закончить ход</button>
              </div>
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
