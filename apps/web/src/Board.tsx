import { useEffect, useRef, useState } from "react";
import { BOARD, TileType, GAME_CONFIG, groupTiles } from "@monopoly/shared";
import type { PropView } from "./net/useGame";

const JAIL_FINE = GAME_CONFIG.jailFine;

// Владею ли я всей цветовой группой этого участка (для стройки на клиенте).
function ownsGroup(properties: Record<number, PropView>, group: string, myId: string): boolean {
  const tiles = groupTiles(group);
  return tiles.length > 0 && tiles.every((t) => properties[t.id]?.ownerId === myId);
}
import type { PlayerView, MoveEvent, RollEvent, TurnStartEvent, CardEvent } from "./net/useGame";
import { gridPos } from "./boardLayout";
import { Tokens } from "./Tokens";
import { Dice, DICE_ANIMATION_MS } from "./Dice";
import { mulberry32, hashStr } from "./seededRandom";

// Крупные суммы с разделителями разрядов: 2000000 → "2 000 000".
const fmt = (n: number) => n.toLocaleString("ru-RU");

const PLAYER_COLORS = ["#e63946", "#457b9d", "#f4a261", "#2a9d8f", "#e9c46a", "#9d4edd"];

const GROUP_COLORS: Record<string, string> = {
  brown: "#8b5a2b", lightblue: "#7ec8e3", pink: "#e75480", orange: "#f4a261",
  red: "#e63946", yellow: "#f9d342", green: "#2a9d8f", darkblue: "#1d3557",
};

const randWith = (rng: () => number, a: number, b: number) => a + rng() * (b - a);
// 4 угла доски (внутри кольца клеток) — кубики каждый бросок приземляются в
// двух РАЗНЫХ углах, чтобы не падать рядом друг с другом.
const DICE_QUADRANTS = [
  (rng: () => number) => ({ left: randWith(rng, 14, 33), top: randWith(rng, 14, 33) }),
  (rng: () => number) => ({ left: randWith(rng, 67, 86), top: randWith(rng, 14, 33) }),
  (rng: () => number) => ({ left: randWith(rng, 14, 33), top: randWith(rng, 67, 86) }),
  (rng: () => number) => ({ left: randWith(rng, 67, 86), top: randWith(rng, 67, 86) }),
];
// rng — детерминированный (сид из данных броска), поэтому у всех игроков на
// экране получаются ОДИНАКОВЫЕ углы, а не каждый считает свои Math.random().
function pickTwoQuadrants(rng: () => number): [{ left: number; top: number }, { left: number; top: number }] {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return [DICE_QUADRANTS[order[0]](rng), DICE_QUADRANTS[order[1]](rng)];
}

export function Board({
  players, properties, currentPlayerId, mySessionId,
  dice1, dice2, awaitingBuyTileId, phase, winnerId, lastRoll, lastMove, lastTurnStart, lastCard,
  onRoll, onBuy, onDecline, onPayJailFine, onUseJailCard,
  onMortgage, onUnmortgage, onBuildHouse, onSellHouse,
}: {
  players: PlayerView[];
  properties: Record<number, PropView>;
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
  lastCard: CardEvent | null;
  onRoll: () => void;
  onBuy: () => void;
  onDecline: () => void;
  onPayJailFine: () => void;
  onUseJailCard: () => void;
  onMortgage: (tileId: number) => void;
  onUnmortgage: (tileId: number) => void;
  onBuildHouse: (tileId: number) => void;
  onSellHouse: (tileId: number) => void;
}) {
  const colorOf = (playerId: string) => PLAYER_COLORS[players.findIndex((p) => p.id === playerId) % PLAYER_COLORS.length];
  const isMyTurn = currentPlayerId === mySessionId;
  const me = players.find((p) => p.id === mySessionId);
  const awaitingTile = awaitingBuyTileId !== 255 ? BOARD[awaitingBuyTileId] : null;
  const rolled = dice1 > 0 || dice2 > 0;
  const inJailNotRolled = isMyTurn && !!me?.inJail && !rolled;

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

  // Новый бросок — разбрасываем кубики по двум разным углам доски. Сид берём
  // из данных самого броска (playerId+d1+d2 — приходят всем одинаково с
  // сервера), а НЕ из локального Math.random() — иначе у каждого игрока
  // кубики оказывались бы в разных местах экрана.
  const [dicePos, setDicePos] = useState(() => pickTwoQuadrants(mulberry32(1)));
  const lastPosKey = useRef("");
  useEffect(() => {
    if (!lastRoll) return;
    const key = `${lastRoll.playerId}:${lastRoll.d1}:${lastRoll.d2}:${lastRoll.ts}`;
    if (key === lastPosKey.current) return;
    lastPosKey.current = key;
    const seed = hashStr(lastRoll.playerId) ^ (lastRoll.d1 * 7919 + lastRoll.d2 * 104729);
    setDicePos(pickTwoQuadrants(mulberry32(seed)));
  }, [lastRoll]);

  // Тост вытянутой карты — показываем ~4.5с, потом скрываем.
  const [card, setCard] = useState<CardEvent | null>(null);
  const cardTs = useRef(0);
  useEffect(() => {
    if (!lastCard || lastCard.ts === cardTs.current) return;
    cardTs.current = lastCard.ts;
    setCard(lastCard);
    const t = setTimeout(() => setCard((c) => (c?.ts === lastCard.ts ? null : c)), 4500);
    return () => clearTimeout(t);
  }, [lastCard]);

  return (
    <div className="board">
      {BOARD.map((tile) => {
        const { col, row } = gridPos(tile.id);
        const prop = properties[tile.id];
        const ownerId = prop?.ownerId;
        const houses = prop?.houses ?? 0;
        return (
          <div
            key={tile.id}
            className="tile"
            style={{
              gridColumn: col,
              gridRow: row,
              borderColor: ownerId ? colorOf(ownerId) : undefined,
              borderWidth: ownerId ? 3 : 1,
              opacity: prop?.mortgaged ? 0.55 : 1,
            }}
          >
            {tile.group && <div className="tileGroup" style={{ background: GROUP_COLORS[tile.group] }} />}
            <div className="tileName">{tile.name}</div>
            {tile.price ? <div className="tilePrice">${fmt(tile.price)}</div> : null}
            {tile.tax ? <div className="tilePrice">${fmt(tile.tax)}</div> : null}
            {houses > 0 && <div className="tileHouses">{houses === 5 ? "🏨" : "🏠".repeat(houses)}</div>}
            {prop?.mortgaged && <div className="tileMortgaged">💰 залог</div>}
          </div>
        );
      })}

      <Tokens players={players} colorOf={colorOf} moveEvent={lastMove} startDelayMs={DICE_ANIMATION_MS} />

      {/* Кубики — оверлей поверх всей доски, каждый бросок разлетаются по разным углам.
          Значение берём из самого события броска (lastRoll), НЕ из dice1/dice2: синк
          состояния и это сообщение идут отдельными пакетами и могут прийти в любом
          порядке — стейт иногда ещё старый в момент броска. */}
      <Dice
        value={lastRoll?.d1 ?? 1} rollTs={lastRoll?.ts ?? 0}
        leftPct={dicePos[0].left} topPct={dicePos[0].top}
        seed={lastRoll ? (hashStr(lastRoll.playerId) ^ (lastRoll.d1 * 7919 + lastRoll.d2 * 104729 + 1)) : 1}
      />
      <Dice
        value={lastRoll?.d2 ?? 1} rollTs={lastRoll?.ts ?? 0}
        leftPct={dicePos[1].left} topPct={dicePos[1].top}
        seed={lastRoll ? (hashStr(lastRoll.playerId) ^ (lastRoll.d1 * 7919 + lastRoll.d2 * 104729 + 2)) : 2}
      />

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
                <p>Купить «{awaitingTile.name}» за ${fmt(awaitingTile.price!)}?</p>
                <button onClick={onBuy}>Купить</button>
                <button onClick={onDecline}>Не покупать</button>
              </div>
            ) : inJailNotRolled ? (
              <div className="buyBox">
                <p className="note">🔒 Ты в тюрьме — выбрось дубль, чтобы выйти</p>
                <button onClick={onRoll}>🎲 Бросить (на дубль)</button>
                <button onClick={onPayJailFine} disabled={(me?.money ?? 0) < JAIL_FINE}>
                  Заплатить ${fmt(JAIL_FINE)}
                </button>
                {(me?.getOutCards ?? 0) > 0 && (
                  <button onClick={onUseJailCard}>Использовать карту освобождения</button>
                )}
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
              {p.name} — ${fmt(p.money)}
              {p.inJail ? " 🔒" : ""}
              {p.getOutCards > 0 ? ` 🃏×${p.getOutCards}` : ""}
              {p.bankrupt ? " 💀" : ""}
            </li>
          ))}
        </ul>

        {isMyTurn && phase === "playing" && (
          <div className="manage">
            <div className="manageTitle">Мои владения (управление в свой ход)</div>
            {BOARD.filter((t) => properties[t.id]?.ownerId === mySessionId).map((t) => {
              const prop = properties[t.id]!;
              const isProp = t.type === TileType.Property;
              const canBuild = isProp && !prop.mortgaged && prop.houses < 5 &&
                ownsGroup(properties, t.group!, mySessionId) &&
                !groupTiles(t.group!).some((g) => properties[g.id]?.mortgaged);
              return (
                <div key={t.id} className="manageRow">
                  <span className="manageName" style={{ borderColor: t.group ? GROUP_COLORS[t.group] : "#2c6b2c" }}>
                    {t.name}{prop.houses === 5 ? " 🏨" : prop.houses > 0 ? " " + "🏠".repeat(prop.houses) : ""}
                  </span>
                  {isProp && canBuild && <button onClick={() => onBuildHouse(t.id)}>🏠 +${fmt(t.houseCost!)}</button>}
                  {isProp && prop.houses > 0 && <button onClick={() => onSellHouse(t.id)}>🏠 −</button>}
                  {!prop.mortgaged && prop.houses === 0 && (
                    <button onClick={() => onMortgage(t.id)}>Заложить</button>
                  )}
                  {prop.mortgaged && <button onClick={() => onUnmortgage(t.id)}>Выкупить</button>}
                </div>
              );
            })}
            {!BOARD.some((t) => properties[t.id]?.ownerId === mySessionId) && (
              <div className="note">Пока нет купленных участков</div>
            )}
          </div>
        )}
      </div>

      {card && (
        <div className={`cardToast ${card.deck}`}>
          <div className="cardToastTitle">{card.deck === "chance" ? "🎲 Шанс" : "💰 Казна"}</div>
          <div className="cardToastText">{card.text}</div>
          <div className="cardToastWho">{players.find((p) => p.id === card.playerId)?.name || ""}</div>
        </div>
      )}
    </div>
  );
}
