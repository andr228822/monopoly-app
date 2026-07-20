import { useEffect, useRef, useState } from "react";
import type { PlayerView, MoveEvent } from "./net/useGame";
import { gridPos } from "./boardLayout";

const STEP_MS = 220; // время одного шага фишки на соседнюю клетку

export function Tokens({
  players, colorOf, moveEvent, startDelayMs = 0,
}: {
  players: PlayerView[];
  colorOf: (id: string) => string;
  moveEvent: MoveEvent | null;
  startDelayMs?: number; // подождать конца анимации кубиков, прежде чем двигать фишку
}) {
  // Отображаемая позиция каждого игрока — двигается пошагово, независимо от
  // «настоящей» p.position (та меняется мгновенно вместе с состоянием сервера).
  const [displayed, setDisplayed] = useState<Record<string, number>>({});
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeyRef = useRef("");

  // Новый игрок — сразу ставим на его текущую клетку (без анимации «от нуля»).
  useEffect(() => {
    setDisplayed((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const p of players) {
        if (!(p.id in next)) { next[p.id] = p.position; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [players]);

  useEffect(() => {
    if (!moveEvent) return;
    // Дедуп по СОДЕРЖИМОМУ хода (а не по метке времени сообщения) — устойчиво
    // даже если событие почему-то доставлено клиенту дважды.
    const key = `${moveEvent.playerId}:${moveEvent.from}:${moveEvent.to}:${moveEvent.direct ? 1 : 0}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    // Отменяем недоигранную анимацию предыдущего хода (например, второй бросок
    // при дубле мог начаться раньше, чем дошла анимация первого) и СРАЗУ ставим
    // фишку на стартовую клетку нового хода — без этого получался рывок/прыжок
    // с того места, где прервалась старая анимация, к началу новой.
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    setDisplayed((prev) => ({ ...prev, [moveEvent.playerId]: moveEvent.from }));

    startTimerRef.current = setTimeout(() => {
      // Телепорт (например, отправка в тюрьму за 3 дубля) — без пошагового обхода клеток.
      if (moveEvent.direct) {
        setDisplayed((prev) => ({ ...prev, [moveEvent.playerId]: moveEvent.to }));
        return;
      }
      const path: number[] = [];
      let cur = moveEvent.from;
      while (cur !== moveEvent.to) {
        cur = (cur + 1) % 40;
        path.push(cur);
      }
      if (path.length === 0) return;
      let i = 0;
      const step = () => {
        setDisplayed((prev) => ({ ...prev, [moveEvent.playerId]: path[i] }));
        i++;
        if (i < path.length) stepTimerRef.current = setTimeout(step, STEP_MS);
      };
      step();
    }, startDelayMs);
  }, [moveEvent, startDelayMs]);

  // Таймеры чистим только при реальном размонтировании компонента.
  useEffect(() => () => {
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
  }, []);

  return (
    <>
      {players.filter((p) => !p.bankrupt).map((p, i) => {
        const tile = displayed[p.id] ?? p.position;
        const { col, row } = gridPos(tile);
        const leftPct = ((col - 1 + 0.5) / 11) * 100;
        const topPct = ((row - 1 + 0.5) / 11) * 100;
        // Небольшой разброс, чтобы фишки на одной клетке не сливались в одну точку.
        const dx = (i % 3) * 8 - 8;
        const dy = (Math.floor(i / 3) % 2) * 8 - 4;
        return (
          <div
            key={p.id}
            className="token"
            title={p.name}
            style={{
              left: `${leftPct}%`,
              top: `${topPct}%`,
              background: colorOf(p.id),
              transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`,
            }}
          />
        );
      })}
    </>
  );
}
