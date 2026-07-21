// Колоды карт «Шанс» и «Казна». Тексты оригинальные (без брендов настоящей
// Monopoly). Денежные суммы заданы базовыми и умножаются на MONEY_SCALE, как и
// цены на доске — чтобы соответствовать крупной экономике (старт 2 млн).
import { MONEY_SCALE } from "./board";

export const CardEffect = {
  Money: "money",                 // amount: изменить деньги игрока (+/-)
  MoveTo: "move_to",              // tile: переместить на клетку (бонус за проход Старта)
  GoToJail: "go_to_jail",         // прямиком в тюрьму, без бонуса за Старт
  GetOutFree: "get_out_free",     // карта «выход из тюрьмы бесплатно» в запас
  CollectFromEach: "collect_each",// amount: получить с КАЖДОГО другого игрока
  PayEach: "pay_each",            // amount: заплатить КАЖДОМУ другому игроку
} as const;
export type CardEffect = (typeof CardEffect)[keyof typeof CardEffect];

export interface Card {
  text: string;
  effect: CardEffect;
  amount?: number; // базовая сумма (для money/collect/pay), наружу отдаётся ×MONEY_SCALE
  tile?: number;   // клетка (для move_to)
}

const CHANCE_BASE: Card[] = [
  { text: "Отправляйтесь на Старт. Получите бонус.", effect: CardEffect.MoveTo, tile: 0 },
  { text: "Вас переводят в тюрьму. Отправляйтесь туда напрямую.", effect: CardEffect.GoToJail },
  { text: "Банк выплачивает вам дивиденды.", effect: CardEffect.Money, amount: 50 },
  { text: "Штраф за превышение скорости.", effect: CardEffect.Money, amount: -15 },
  { text: "Двигайтесь на Императорскую пл.", effect: CardEffect.MoveTo, tile: 39 },
  { text: "Двигайтесь на Северный вокзал.", effect: CardEffect.MoveTo, tile: 5 },
  { text: "Карта «Выход из тюрьмы бесплатно». Сохраните её.", effect: CardEffect.GetOutFree },
  { text: "Вы избраны председателем совета. Заплатите каждому игроку.", effect: CardEffect.PayEach, amount: 50 },
  { text: "Ваши инвестиции окупились.", effect: CardEffect.Money, amount: 150 },
  { text: "Ремонт автомобиля. Оплатите счёт.", effect: CardEffect.Money, amount: -25 },
];

const CHEST_BASE: Card[] = [
  { text: "Отправляйтесь на Старт. Получите бонус.", effect: CardEffect.MoveTo, tile: 0 },
  { text: "Ошибка банка в вашу пользу. Получите деньги.", effect: CardEffect.Money, amount: 200 },
  { text: "Оплата услуг врача.", effect: CardEffect.Money, amount: -50 },
  { text: "Вас переводят в тюрьму. Отправляйтесь туда напрямую.", effect: CardEffect.GoToJail },
  { text: "Карта «Выход из тюрьмы бесплатно». Сохраните её.", effect: CardEffect.GetOutFree },
  { text: "Возврат подоходного налога.", effect: CardEffect.Money, amount: 20 },
  { text: "У вас день рождения. Получите с каждого игрока.", effect: CardEffect.CollectFromEach, amount: 10 },
  { text: "Оплата страхового взноса.", effect: CardEffect.Money, amount: -50 },
  { text: "Вы получили наследство.", effect: CardEffect.Money, amount: 100 },
  { text: "Оплата счёта за обучение.", effect: CardEffect.Money, amount: -100 },
];

const scale = (c: Card): Card => (c.amount == null ? c : { ...c, amount: c.amount * MONEY_SCALE });

export const CHANCE_DECK: Card[] = CHANCE_BASE.map(scale);
export const CHEST_DECK: Card[] = CHEST_BASE.map(scale);

// Случайная карта из колоды (Фаза 2: без отслеживания порядка колоды — просто рандом).
export function drawCard(deck: "chance" | "chest", rnd: () => number = Math.random): Card {
  const cards = deck === "chance" ? CHANCE_DECK : CHEST_DECK;
  return cards[Math.floor(rnd() * cards.length)];
}
