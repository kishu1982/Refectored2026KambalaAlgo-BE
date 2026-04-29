export function calcInitialSL(
  openPrice: number,
  side: 'BUY' | 'SELL',
  percent: number,
): number {
  const diff = openPrice * percent;
  return side === 'BUY' ? openPrice - diff : openPrice + diff;
}

export function trailSL(
  ltp: number,
  side: 'BUY' | 'SELL',
  trail: number,
): number {
  return side === 'BUY' ? ltp - trail : ltp + trail;
}


export function calculateHalfLots(openLots: number): number {
  if (openLots <= 1) return 0;
  return Math.floor(openLots / 2);
}
