// Данные доски — 40 клеток по кругу. Оригинальные названия (без привязки
// к реальным брендам), классическая раскладка и таблицы аренды.
export const TileType = {
  Go: "go",
  Property: "property",
  Railroad: "railroad",
  Utility: "utility",
  Chance: "chance",
  Chest: "chest",
  Tax: "tax",
  Jail: "jail",
  FreeParking: "free_parking",
  GoToJail: "go_to_jail",
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export interface Tile {
  id: number;
  type: TileType;
  name: string;
  group?: string;      // цветовая группа (для property)
  price?: number;      // цена покупки (property/railroad/utility)
  rents?: number[];    // [база, 1 дом, 2, 3, 4, отель] — только для property
  houseCost?: number;  // цена одного дома/отеля — только для property
  tax?: number;        // сумма налога (Tax)
}

// Множитель экономики: базовые числа ниже — классические, наружу отдаём ×MONEY_SCALE
// (крупные «настоящие» суммы под стартовый капитал 2 млн). Пропорции сохраняются.
export const MONEY_SCALE = 1000;

// Аренда железной дороги по числу ж/д во владении (1..4). Коммунальные — множитель к сумме кубиков.
export const RAILROAD_RENT = [25, 50, 100, 200].map((v) => v * MONEY_SCALE);
export const UTILITY_MULT = { one: 4, both: 10 };

// property: [name, group, price, rents(6), houseCost]; rr/util: price
const P = (id: number, name: string, group: string, price: number, rents: number[], houseCost: number): Tile =>
  ({ id, type: TileType.Property, name, group, price, rents, houseCost });

const BOARD_BASE: Tile[] = [
  { id: 0, type: TileType.Go, name: "Старт" },
  P(1, "Лесная ул.", "brown", 60, [2, 10, 30, 90, 160, 250], 50),
  { id: 2, type: TileType.Chest, name: "Казна" },
  P(3, "Полевая ул.", "brown", 60, [4, 20, 60, 180, 320, 450], 50),
  { id: 4, type: TileType.Tax, name: "Подоходный налог", tax: 200 },
  { id: 5, type: TileType.Railroad, name: "Северный вокзал", price: 200 },
  P(6, "Речная ул.", "lightblue", 100, [6, 30, 90, 270, 400, 550], 50),
  { id: 7, type: TileType.Chance, name: "Шанс" },
  P(8, "Озёрная ул.", "lightblue", 100, [6, 30, 90, 270, 400, 550], 50),
  P(9, "Морская наб.", "lightblue", 120, [8, 40, 100, 300, 450, 600], 50),
  { id: 10, type: TileType.Jail, name: "Тюрьма / Просто в гостях" },
  P(11, "Садовая ул.", "pink", 140, [10, 50, 150, 450, 625, 750], 100),
  { id: 12, type: TileType.Utility, name: "Электростанция", price: 150 },
  P(13, "Цветочная ул.", "pink", 140, [10, 50, 150, 450, 625, 750], 100),
  P(14, "Парковая ул.", "pink", 160, [12, 60, 180, 500, 700, 900], 100),
  { id: 15, type: TileType.Railroad, name: "Южный вокзал", price: 200 },
  P(16, "Заводская ул.", "orange", 180, [14, 70, 200, 550, 750, 950], 100),
  { id: 17, type: TileType.Chest, name: "Казна" },
  P(18, "Складская ул.", "orange", 180, [14, 70, 200, 550, 750, 950], 100),
  P(19, "Портовая ул.", "orange", 200, [16, 80, 220, 600, 800, 1000], 100),
  { id: 20, type: TileType.FreeParking, name: "Бесплатная парковка" },
  P(21, "Театральная ул.", "red", 220, [18, 90, 250, 700, 875, 1050], 150),
  { id: 22, type: TileType.Chance, name: "Шанс" },
  P(23, "Музейная ул.", "red", 220, [18, 90, 250, 700, 875, 1050], 150),
  P(24, "Соборная пл.", "red", 240, [20, 100, 300, 750, 925, 1100], 150),
  { id: 25, type: TileType.Railroad, name: "Восточный вокзал", price: 200 },
  P(26, "Университетская ул.", "yellow", 260, [22, 110, 330, 800, 975, 1150], 150),
  P(27, "Библиотечная ул.", "yellow", 260, [22, 110, 330, 800, 975, 1150], 150),
  { id: 28, type: TileType.Utility, name: "Водоканал", price: 150 },
  P(29, "Ратушная пл.", "yellow", 280, [24, 120, 360, 850, 1025, 1200], 150),
  { id: 30, type: TileType.GoToJail, name: "Иди в тюрьму" },
  P(31, "Банковская ул.", "green", 300, [26, 130, 390, 900, 1100, 1275], 200),
  P(32, "Биржевая ул.", "green", 300, [26, 130, 390, 900, 1100, 1275], 200),
  { id: 33, type: TileType.Chest, name: "Казна" },
  P(34, "Дворцовая наб.", "green", 320, [28, 150, 450, 1000, 1200, 1400], 200),
  { id: 35, type: TileType.Railroad, name: "Западный вокзал", price: 200 },
  { id: 36, type: TileType.Chance, name: "Шанс" },
  P(37, "Столичный пр.", "darkblue", 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { id: 38, type: TileType.Tax, name: "Налог на роскошь", tax: 100 },
  P(39, "Императорская пл.", "darkblue", 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

const s = (v?: number) => (v == null ? v : v * MONEY_SCALE);
export const BOARD: Tile[] = BOARD_BASE.map((t) => ({
  ...t,
  price: s(t.price),
  tax: s(t.tax),
  houseCost: s(t.houseCost),
  rents: t.rents ? t.rents.map((r) => r * MONEY_SCALE) : undefined,
}));

export function tileAt(id: number): Tile {
  return BOARD[((id % 40) + 40) % 40];
}

// Все клетки одной цветовой группы (для проверки монополии/застройки).
export function groupTiles(group: string): Tile[] {
  return BOARD.filter((t) => t.group === group);
}
