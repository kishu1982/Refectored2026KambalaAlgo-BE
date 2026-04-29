export interface TickData {
  tk: string; // token
  e: string; // exchange
  lp?: number;
  ls?: number;
}

export interface NormalizedTick {
  tk: string;
  e: string;
  lp: number; // ✅ guaranteed number
  ft?: number;
}


export interface SLTargetTrack {
  exchange: string;
  token: string;
  tradingSymbol: string;
  side: 'BUY' | 'SELL';
  productType: 'I' | 'M';

  openPrice: number;
  lotSize: number;

  initialLots: number;
  closedLots: number;

  netQty: number;

  slTriggerPrice: number;
  slOrderId?: string;

  stage: 'INITIAL' | 'FIRST_PROFIT' | 'BREAKEVEN';
  lastAction: string;

  targetActions: Array<{
    orderId: string;
    closedLots: number;
    remainingLots: number;
    price: number;
    time: string;
  }>;

  updatedAt: string;
}

