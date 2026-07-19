// Позиция клетки id (0-39) в сетке 11x11 (по периметру, против часовой стрелки от GO).
export function gridPos(id: number): { col: number; row: number } {
  if (id === 0) return { col: 11, row: 11 };
  if (id <= 9) return { col: 11 - id, row: 11 };
  if (id === 10) return { col: 1, row: 11 };
  if (id <= 19) return { col: 1, row: 21 - id };
  if (id === 20) return { col: 1, row: 1 };
  if (id <= 29) return { col: id - 19, row: 1 };
  if (id === 30) return { col: 11, row: 1 };
  return { col: 11, row: id - 29 };
}
