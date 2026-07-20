import { useEffect, useRef, useState } from "react";
import type { PlayerView, MoveEvent } from "./net/useGame";
import { gridPos } from "./boardLayout";

const STEP_MS = 180; // время одного шага фишки на соседнюю клетку

// Пошаговая анимация фишек. Показываемая позиция каждого игрока (state `pos`)
// двигается по одной клетке к цели через setInterval. У каждого игрока не больше
// одной активной анимации — новый ход отменяет предыдущую (важно для дубля, где
// второй бросок приходит до конца первой анимации). Позиции берутся с сервера
// (from/to одинаковы всем) → картинка синхронна у всех игроков.
export function Tokens({
  players, colorOf, moveEvent, startDelayMs = 0,
}: {
  players: PlayerView[];
  colorOf: (id: string) => string;
  moveEvent: MoveEvent | null;
  startDelayMs?: number; // подождать конца анимации кубиков, прежде чем двигать фишку
}) {
  const [pos, setPos] = useState<Record<string, number>>({});
  // Активные таймеры по игроку — чтобы отменить недоигранную анимацию при новом ходе.
  const timers = useRef<Record<string, { start?: any; walk?: any }>>({});

  const clearFor = (id: string) => {
    const t = timers.current[id];
    if (t) {
      if (t.start) clearTimeout(t.start);
      if (t.walk) clearInterval(t.walk);
      delete timers.current[id];
    }
  };

  // Новый игрок — сразу ставим на его текущую клетку (без анимации «от нуля»).
  useEffect(() => {
    setPos((prev) => {
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
    const mv = moveEvent;
    clearFor(mv.playerId); // отменяем прошлую анимацию этого игрока, если ещё идёт

    const start = setTimeout(() => {
      if (mv.direct) {
        // Телепорт (тюрьма за 3 дубля) — без обхода клеток.
        setPos((p) => ({ ...p, [mv.playerId]: mv.to }));
        delete timers.current[mv.playerId];
        return;
      }
      setPos((p) => ({ ...p, [mv.playerId]: mv.from })); // фишка стартует с начальной клетки хода
      let cur = mv.from;
      const walk = setInterval(() => {
        cur = (cur + 1) % 40; // ходы всегда вперёд → шагаем по кругу
        setPos((p) => ({ ...p, [mv.playerId]: cur }));
        if (cur === mv.to) { clearInterval(walk); delete timers.current[mv.playerId]; }
      }, STEP_MS);
      timers.current[mv.playerId] = { walk };
    }, startDelayMs);
    timers.current[mv.playerId] = { start };
  }, [moveEvent, startDelayMs]);

  // Чистим все таймеры при размонтировании.
  useEffect(() => () => {
    for (const id in timers.current) clearFor(id);
  }, []);

  return (
    <>
      {players.filter((p) => !p.bankrupt).map((p, i) => {
        const tile = pos[p.id] ?? p.position;
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
