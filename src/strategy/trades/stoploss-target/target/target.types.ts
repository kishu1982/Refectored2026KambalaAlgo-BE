export interface TargetCheckContext {
  token: string;
  exchange: string;
  ltp: number;
  instrument: any;
}

export interface TargetTrackEntry {
  action: string;
  reason?: string;
  entryPrice?: number;
  targetPrice?: number;
  netQty?: number;
  closeQty?: number;
  time: string;
}
