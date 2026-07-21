// Данные доски — 40 клеток по кругу. Оригинальные названия (без привязки
// к реальным брендам), классическая раскладка цветовых групп/цен/ж.д./коммунальных.
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
  group?: string;   // цветовая группа (для property)
  price?: number;
  rent?: number;     // базовая аренда без домов (Фаза 1/2), для ж.д./коммунальных — тоже база
  tax?: number;      // сумма налога (Tax)
}

// Множитель экономики: базовые числа ниже — классические, наружу отдаём ×MONEY_SCALE
// (крупные «настоящие» суммы под стартовый капитал 2 млн). Пропорции сохраняются.
export const MONEY_SCALE = 1000;

const BOARD_BASE: Tile[] = [
  { id: 0, type: TileType.Go, name: "Старт" },
  { id: 1, type: TileType.Property, name: "Лесная ул.", group: "brown", price: 60, rent: 2 },
  { id: 2, type: TileType.Chest, name: "Казна" },
  { id: 3, type: TileType.Property, name: "Полевая ул.", group: "brown", price: 60, rent: 4 },
  { id: 4, type: TileType.Tax, name: "Подоходный налог", tax: 200 },
  { id: 5, type: TileType.Railroad, name: "Северный вокзал", price: 200, rent: 25 },
  { id: 6, type: TileType.Property, name: "Речная ул.", group: "lightblue", price: 100, rent: 6 },
  { id: 7, type: TileType.Chance, name: "Шанс" },
  { id: 8, type: TileType.Property, name: "Озёрная ул.", group: "lightblue", price: 100, rent: 6 },
  { id: 9, type: TileType.Property, name: "Морская наб.", group: "lightblue", price: 120, rent: 8 },
  { id: 10, type: TileType.Jail, name: "Тюрьма / Просто в гостях" },
  { id: 11, type: TileType.Property, name: "Садовая ул.", group: "pink", price: 140, rent: 10 },
  { id: 12, type: TileType.Utility, name: "Электростанция", price: 150, rent: 4 },
  { id: 13, type: TileType.Property, name: "Цветочная ул.", group: "pink", price: 140, rent: 10 },
  { id: 14, type: TileType.Property, name: "Парковая ул.", group: "pink", price: 160, rent: 12 },
  { id: 15, type: TileType.Railroad, name: "Южный вокзал", price: 200, rent: 25 },
  { id: 16, type: TileType.Property, name: "Заводская ул.", group: "orange", price: 180, rent: 14 },
  { id: 17, type: TileType.Chest, name: "Казна" },
  { id: 18, type: TileType.Property, name: "Складская ул.", group: "orange", price: 180, rent: 14 },
  { id: 19, type: TileType.Property, name: "Портовая ул.", group: "orange", price: 200, rent: 16 },
  { id: 20, type: TileType.FreeParking, name: "Бесплатная парковка" },
  { id: 21, type: TileType.Property, name: "Театральная ул.", group: "red", price: 220, rent: 18 },
  { id: 22, type: TileType.Chance, name: "Шанс" },
  { id: 23, type: TileType.Property, name: "Музейная ул.", group: "red", price: 220, rent: 18 },
  { id: 24, type: TileType.Property, name: "Соборная пл.", group: "red", price: 240, rent: 20 },
  { id: 25, type: TileType.Railroad, name: "Восточный вокзал", price: 200, rent: 25 },
  { id: 26, type: TileType.Property, name: "Университетская ул.", group: "yellow", price: 260, rent: 22 },
  { id: 27, type: TileType.Property, name: "Библиотечная ул.", group: "yellow", price: 260, rent: 22 },
  { id: 28, type: TileType.Utility, name: "Водоканал", price: 150, rent: 4 },
  { id: 29, type: TileType.Property, name: "Ратушная пл.", group: "yellow", price: 280, rent: 24 },
  { id: 30, type: TileType.GoToJail, name: "Иди в тюрьму" },
  { id: 31, type: TileType.Property, name: "Банковская ул.", group: "green", price: 300, rent: 26 },
  { id: 32, type: TileType.Property, name: "Биржевая ул.", group: "green", price: 300, rent: 26 },
  { id: 33, type: TileType.Chest, name: "Казна" },
  { id: 34, type: TileType.Property, name: "Дворцовая наб.", group: "green", price: 320, rent: 28 },
  { id: 35, type: TileType.Railroad, name: "Западный вокзал", price: 200, rent: 25 },
  { id: 36, type: TileType.Chance, name: "Шанс" },
  { id: 37, type: TileType.Property, name: "Столичный пр.", group: "darkblue", price: 350, rent: 35 },
  { id: 38, type: TileType.Tax, name: "Налог на роскошь", tax: 100 },
  { id: 39, type: TileType.Property, name: "Императорская пл.", group: "darkblue", price: 400, rent: 50 },
];

const scale = (v?: number) => (v == null ? v : v * MONEY_SCALE);
export const BOARD: Tile[] = BOARD_BASE.map((t) => ({
  ...t,
  price: scale(t.price),
  rent: scale(t.rent),
  tax: scale(t.tax),
}));

export function tileAt(id: number): Tile {
  return BOARD[((id % 40) + 40) % 40];
}
