export interface TradeLeg {
  tokenNumber: string;
  exchange: string;
  symbolName: string;
  quantityLots: number;
  side: 'BUY' | 'SELL';
  productType: 'INTRADAY' | 'NORMAL' | 'DELIVERY';
  strategyName: string;
  legs: number;
}
