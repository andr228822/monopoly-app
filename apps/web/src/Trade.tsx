import { useMemo, useState } from "react";
import { BOARD, TileType, groupTiles } from "@monopoly/shared";
import type { PlayerView, PropView, TradeView, TradeProposal } from "./net/useGame";

const fmt = (n: number) => n.toLocaleString("ru-RU");

// Клиентское зеркало canTradeProperty: клетка покупаемая, принадлежит ownerId,
// и в её цветовой группе нет застройки (дома надо продать до обмена).
function canTrade(properties: Record<number, PropView>, tileId: number, ownerId: string): boolean {
  const tile = BOARD[tileId];
  const purchasable = tile.type === TileType.Property || tile.type === TileType.Railroad || tile.type === TileType.Utility;
  if (!purchasable || properties[tileId]?.ownerId !== ownerId) return false;
  if (tile.type === TileType.Property && tile.group && groupTiles(tile.group).some((t) => (properties[t.id]?.houses ?? 0) > 0)) return false;
  return true;
}

function tradeableTiles(properties: Record<number, PropView>, ownerId: string): number[] {
  return BOARD.filter((t) => canTrade(properties, t.id, ownerId)).map((t) => t.id);
}

// Оверлей активного обмена: получатель видит «Принять/Отклонить», предлагающий —
// «Ожидание…/Отменить», остальные — короткую справку. Таймер общий (сек эпохи).
export function TradeOverlay({
  trade, players, mySessionId, nowSec, onAccept, onDecline,
}: {
  trade: TradeView;
  players: PlayerView[];
  mySessionId: string;
  nowSec: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const from = players.find((p) => p.id === trade.fromId);
  const to = players.find((p) => p.id === trade.toId);
  const amRecipient = mySessionId === trade.toId;
  const amProposer = mySessionId === trade.fromId;
  const secs = Math.max(0, trade.deadline - nowSec);

  const propList = (ids: number[]) =>
    ids.length ? ids.map((id) => BOARD[id].name).join(", ") : "—";

  // «Отдаёт» и «Получает» — с точки зрения предлагающего (from).
  const gives: string[] = [];
  if (trade.offerProps.length) gives.push(propList(trade.offerProps));
  if (trade.offerMoney) gives.push(`$${fmt(trade.offerMoney)}`);
  if (trade.offerCards) gives.push(`🃏×${trade.offerCards}`);
  const gets: string[] = [];
  if (trade.requestProps.length) gets.push(propList(trade.requestProps));
  if (trade.requestMoney) gets.push(`$${fmt(trade.requestMoney)}`);
  if (trade.requestCards) gets.push(`🃏×${trade.requestCards}`);

  return (
    <div className="tradeOverlay">
      <div className="tradeBox">
        <div className="tradeTitle">🤝 Обмен</div>
        <div className="tradeParties">
          <b>{from?.name || "?"}</b> предлагает обмен игроку <b>{to?.name || "?"}</b>
        </div>
        <div className="tradeCols">
          <div className="tradeCol">
            <div className="tradeColHead">{from?.name} отдаёт</div>
            <div className="tradeColBody">{gives.length ? gives.join(" + ") : "ничего"}</div>
          </div>
          <div className="tradeArrow">⇄</div>
          <div className="tradeCol">
            <div className="tradeColHead">{to?.name} отдаёт</div>
            <div className="tradeColBody">{gets.length ? gets.join(" + ") : "ничего"}</div>
          </div>
        </div>
        <div className="tradeTimer">⏱ {secs}с</div>
        {amRecipient ? (
          <div className="tradeBtns">
            <button className="tradeAccept" onClick={onAccept}>Принять</button>
            <button className="tradeDecline" onClick={onDecline}>Отклонить</button>
          </div>
        ) : amProposer ? (
          <div className="tradeBtns">
            <span className="note">Ожидание ответа…</span>
            <button className="tradeDecline" onClick={onDecline}>Отменить</button>
          </div>
        ) : (
          <div className="note">Идёт обмен между игроками</div>
        )}
      </div>
    </div>
  );
}

// Конструктор предложения: выбор получателя, участков с обеих сторон, денег и карт.
export function TradeBuilder({
  players, me, properties, mySessionId, onSubmit, onCancel,
}: {
  players: PlayerView[];
  me: PlayerView;
  properties: Record<number, PropView>;
  mySessionId: string;
  onSubmit: (p: TradeProposal) => void;
  onCancel: () => void;
}) {
  const others = players.filter((p) => p.id !== mySessionId && !p.bankrupt);
  const [toId, setToId] = useState(others[0]?.id || "");
  const [offerProps, setOfferProps] = useState<Set<number>>(new Set());
  const [requestProps, setRequestProps] = useState<Set<number>>(new Set());
  const [offerMoney, setOfferMoney] = useState(0);
  const [requestMoney, setRequestMoney] = useState(0);
  const [offerCards, setOfferCards] = useState(0);
  const [requestCards, setRequestCards] = useState(0);

  const to = others.find((p) => p.id === toId);
  const myTiles = useMemo(() => tradeableTiles(properties, mySessionId), [properties, mySessionId]);
  const theirTiles = useMemo(() => (toId ? tradeableTiles(properties, toId) : []), [properties, toId]);

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, id: number) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };

  const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.floor(v || 0), max));
  const empty = offerProps.size === 0 && requestProps.size === 0 &&
    offerMoney === 0 && requestMoney === 0 && offerCards === 0 && requestCards === 0;

  const submit = () => {
    if (!toId || empty) return;
    onSubmit({
      toId,
      offerProps: [...offerProps], requestProps: [...requestProps],
      offerMoney: clamp(offerMoney, me.money),
      requestMoney: clamp(requestMoney, to?.money ?? 0),
      offerCards: clamp(offerCards, me.getOutCards),
      requestCards: clamp(requestCards, to?.getOutCards ?? 0),
    });
  };

  const chip = (id: number, on: boolean, onClick: () => void) => (
    <button key={id} className={`tradeChip ${on ? "on" : ""}`} onClick={onClick}>
      {BOARD[id].name}
    </button>
  );

  return (
    <div className="tradeOverlay">
      <div className="tradeBox tradeBuilder">
        <div className="tradeTitle">🤝 Предложить обмен</div>

        <label className="tradeField">
          Кому:
          <select value={toId} onChange={(e) => { setToId(e.target.value); setRequestProps(new Set()); }}>
            {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <div className="tradeCols">
          <div className="tradeCol">
            <div className="tradeColHead">Я отдаю</div>
            <div className="tradeChips">
              {myTiles.length ? myTiles.map((id) => chip(id, offerProps.has(id), () => toggle(offerProps, setOfferProps, id)))
                : <span className="note">нет участков</span>}
            </div>
            <label className="tradeField">$
              <input type="number" min={0} max={me.money} value={offerMoney}
                onChange={(e) => setOfferMoney(clamp(+e.target.value, me.money))} />
            </label>
            {me.getOutCards > 0 && (
              <label className="tradeField">🃏
                <input type="number" min={0} max={me.getOutCards} value={offerCards}
                  onChange={(e) => setOfferCards(clamp(+e.target.value, me.getOutCards))} />
              </label>
            )}
          </div>

          <div className="tradeArrow">⇄</div>

          <div className="tradeCol">
            <div className="tradeColHead">Прошу у {to?.name || "…"}</div>
            <div className="tradeChips">
              {theirTiles.length ? theirTiles.map((id) => chip(id, requestProps.has(id), () => toggle(requestProps, setRequestProps, id)))
                : <span className="note">нет участков</span>}
            </div>
            <label className="tradeField">$
              <input type="number" min={0} max={to?.money ?? 0} value={requestMoney}
                onChange={(e) => setRequestMoney(clamp(+e.target.value, to?.money ?? 0))} />
            </label>
            {(to?.getOutCards ?? 0) > 0 && (
              <label className="tradeField">🃏
                <input type="number" min={0} max={to?.getOutCards ?? 0} value={requestCards}
                  onChange={(e) => setRequestCards(clamp(+e.target.value, to?.getOutCards ?? 0))} />
              </label>
            )}
          </div>
        </div>

        <div className="tradeBtns">
          <button className="tradeAccept" disabled={!toId || empty} onClick={submit}>Отправить</button>
          <button className="tradeDecline" onClick={onCancel}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
