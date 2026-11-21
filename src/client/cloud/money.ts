export const moneyPrecision = { minimumFractionDigits: 2, maximumFractionDigits: 2, roundingMode: 'trunc' } as const;
const usd = new Intl.NumberFormat('ru-RU', moneyPrecision);
export const formatUsd = (amount: number) => usd.format(amount) + ' $';
