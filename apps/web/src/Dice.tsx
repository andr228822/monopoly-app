import { useRef } from "react";

// Псевдо-3D кубик на CSS-трансформах: настоящий куб из 6 граней (transform-style:
// preserve-3d), при броске крутится на несколько оборотов и падает с отскоком,
// останавливаясь на нужной грани. Без внешних библиотек/физики — чистый CSS.

const DOT_PATTERNS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// Инверсия положения грани — какой поворот куба выводит эту грань вперёд.
// Значения по осям X/Y в градусах [0..350], нормализованные (отрицательные -> +360).
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

export function Dice({ value, rollTs }: { value: number; rollTs: number }) {
  const rotRef = useRef({ x: 0, y: 0 });
  if (value >= 1 && value <= 6) {
    const target = TARGET_ROTATION[value];
    rotRef.current = { x: nextAngle(rotRef.current.x, target.x), y: nextAngle(rotRef.current.y, target.y) };
  }
  const { x, y } = rotRef.current;

  return (
    <div className="diceFall" key={rollTs}>
      <div className="diceScene">
        <div className="diceCube" style={{ transform: `rotateX(${x}deg) rotateY(${y}deg)` }}>
          <Face value={1} transform="translateZ(20px)" />
          <Face value={6} transform="rotateY(180deg) translateZ(20px)" />
          <Face value={3} transform="rotateY(90deg) translateZ(20px)" />
          <Face value={4} transform="rotateY(-90deg) translateZ(20px)" />
          <Face value={5} transform="rotateX(90deg) translateZ(20px)" />
          <Face value={2} transform="rotateX(-90deg) translateZ(20px)" />
        </div>
      </div>
    </div>
  );
}
