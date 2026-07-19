import { BOARD, TileType } from "@monopoly/shared";
import type { PlayerView } from "./net/useGame";

const PLAYER_COLORS = ["#e63946", "#457b9d", "#f4a261", "#2a9d8f", "#e9c46a", "#9d4edd"];

const GROUP_COLORS: Record<string, string> = {
  brown: "#8b5a2b", lightblue: "#7ec8e3", pink: "#e75480", orange: "#f4a261",
  red: "#e63946", yellow: "#f9d342", green: "#2a9d8f", darkblue: "#1d3557",
};

// Позиция клетки id (0-39) в сетке 11x11 (по периметру, против часовой стрелки от GO).
function gridPos(id: number): { col: number; row: number } {
  if (id === 0) return { col: 11, row: 11 };
  if (id <= 9) return { col: 11 - id, row: 11 };
  if (id === 10) return { col: 1, row: 11 };
  if (id <= 19) return { col: 1, row: 21 - id };
  if (id === 20) return { col: 1, row: 1 };
  if (id <= 29) return { col: id - 19, row: 1 };
  if (id === 30) return { col: 11, row: 1 };
  return { col: 11, row: id - 29 };
}

export function Board({
  players, properties, currentPlayerId, mySessionId,
  dice1, dice2, awaitingBuyTileId, phase, winnerId,
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
  onRoll: () => void;
  onBuy: () => void;
  onDecline: () => void;
  onEndTurn: () => void;
}) {
  const colorOf = (playerId: string) => PLAYER_COLORS[players.findIndex((p) => p.id === playerId) % PLAYER_COLORS.length];
  const isMyTurn = currentPlayerId === mySessionId;
  const awaitingTile = awaitingBuyTileId !== 255 ? BOARD[awaitingBuyTileId] : null;

  return (
    <div className="board">
      {BOARD.map((tile) => {
        const { col, row } = gridPos(tile.id);
        const ownerId = properties[tile.id];
        const here = players.filter((p) => p.position === tile.id && !p.bankrupt);
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
            <div className="tileTokens">
              {here.map((p) => (
                <span key={p.id} className="token" style={{ background: colorOf(p.id) }} title={p.name} />
              ))}
            </div>
          </div>
        );
      })}

      <div className="center">
        {phase === "game_over" ? (
          <p className="winner">🏆 Победил: {players.find((p) => p.id === winnerId)?.name || "никто"}</p>
        ) : (
          <>
            <p className="turn">
              {isMyTurn ? "Твой ход" : `Ходит: ${players.find((p) => p.id === currentPlayerId)?.name || "…"}`}
            </p>
            {(dice1 > 0 || dice2 > 0) && <p className="dice">🎲 {dice1} + {dice2} = {dice1 + dice2}</p>}
            {isMyTurn && awaitingTile ? (
              <div className="buyBox">
                <p>Купить «{awaitingTile.name}» за ${awaitingTile.price}?</p>
                <button onClick={onBuy}>Купить</button>
                <button onClick={onDecline}>Не покупать</button>
              </div>
            ) : isMyTurn ? (
              <div className="buyBox">
                <button onClick={onRoll} disabled={dice1 > 0 || dice2 > 0}>🎲 Бросить кубики</button>
                <button onClick={onEndTurn} disabled={!(dice1 > 0 || dice2 > 0)}>Закончить ход</button>
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
