import { useEffect, useRef, useState } from "react";
import { mulberry32 } from "./seededRandom";

// Псевдо-3D кубик на CSS-трансформах: настоящий куб из 6 граней (transform-style:
// preserve-3d). При новом броске (rollTs меняется) — «прилетает» снизу через доску
// с разлётом/тумблингом (см. @keyframes diceFall) и крутится на несколько оборотов,
// останавливаясь на нужной грани и на своём (случайном) месте на доске.

const DOT_PATTERNS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// Инверсия положения грани — какой поворот куба выводит эту грань вперёд.
const TARGET_ROTATION: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  2: { x: 90, y: 0 },
  3: { x: 0, y: 270 },
  4: { x: 0, y: 90 },
  5: { x: 270, y: 0 },
  6: { x: 0, y: 180 },
};

function Face({ value, transform }: { value: number; transform: string }) {
  const dots = DOT_PATTERNS[value] || [];
  return (
    <div className="diceFace" style={{ transform }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="diceDot" style={{ visibility: dots.includes(i) ? "visible" : "hidden" }} />
      ))}
    </div>
  );
}

// Следующий угол поворота: несколько полных оборотов вперёд + точная посадка на target.
function nextAngle(prevTotal: number, target: number): number {
  const spins = 2 + Math.floor(Math.random() * 3); // 2-4 доп. оборота
  const baseTurns = Math.floor(prevTotal / 360) + spins;
  return baseTurns * 360 + target;
}

export function Dice({
  value, rollTs, leftPct, topPct, seed,
}: {
  value: number;
  rollTs: number;
  leftPct: number; // где кубик приземляется на доске (% от ширины/высоты)
  topPct: number;
  seed: number; // из данных броска — чтобы разлёт был одинаковым у всех экранов
}) {
  const [rot, setRot] = useState({ x: 0, y: 0 });
  const lastTs = useRef(0);
  const fallRef = useRef<HTMLDivElement | null>(null);

  // Реагируем ТОЛЬКО на настоящий новый бросок (rollTs) — не на любое изменение
  // value (иначе кубик ложно крутится, когда сервер сбрасывает dice в 0 при смене хода).
  useEffect(() => {
    if (!rollTs || rollTs === lastTs.current) return;
    lastTs.current = rollTs;
    const v = value >= 1 && value <= 6 ? value : 1;
    const target = TARGET_ROTATION[v];
    setRot((prev) => ({ x: nextAngle(prev.x, target.x), y: nextAngle(prev.y, target.y) }));

    // Разлёт «броска» — летит снизу доски (положительный Y) с боковым разбросом.
    // Детерминированный (сид из данных броска) — одинаковый у всех экранов.
    const rng = mulberry32(seed);
    const el = fallRef.current;
    if (el) {
      el.style.setProperty("--fx", `${(rng() * 2 - 1) * 90}px`);
      el.style.setProperty("--fy", `${140 + rng() * 100}px`);
      el.style.setProperty("--frot", `${(rng() * 2 - 1) * 90}deg`);
      // Перезапуск CSS keyframe-анимации без ремаунта (иначе куб потерял бы transition).
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    }
  }, [rollTs, value, seed]);

  return (
    <div className="diceAnchor" style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
      <div className="diceFall" ref={fallRef}>
        <div className="diceScene">
          <div className="diceCube" style={{ transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg)` }}>
            <Face value={1} transform="translateZ(20px)" />
            <Face value={6} transform="rotateY(180deg) translateZ(20px)" />
            <Face value={3} transform="rotateY(90deg) translateZ(20px)" />
            <Face value={4} transform="rotateY(-90deg) translateZ(20px)" />
            <Face value={5} transform="rotateX(90deg) translateZ(20px)" />
            <Face value={2} transform="rotateX(-90deg) translateZ(20px)" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Сколько реально длится анимация одного броска (сумма разлёта+тумблинга) — чтобы
// синхронизировать старт движения фишки (Tokens.tsx) через Board.tsx.
export const DICE_ANIMATION_MS = 1000;
