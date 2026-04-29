import { ConfigService } from '@nestjs/config';

/**
 * Exchanges where trading time restriction applies
 */
const TIME_RESTRICTED_EXCHANGES = new Set(['NSE', 'NFO', 'BSE', 'BFO']);

/**
 * Check if trading is allowed for given exchange (IST based)
 */
export function isTradingAllowedForExchange(
  exchange: string,
  configService: ConfigService,
): boolean {
  // ✅ No restriction → always allowed
  if (!TIME_RESTRICTED_EXCHANGES.has(exchange)) {
    return true;
  }

  const startTime = configService.get<string>('TRADING_START_TIMES', '09:29');
  const endTime = configService.get<string>('TRADING_END_TIME', '15:25');

  // 🔒 Break time config
  const breakEnabled =
    configService.get<string>('TRADING_BREAK_ENABLED', 'false') === 'true';

  const breakStart = configService.get<string>(
    'TRADING_BREAK_START_TIME',
    '12:00',
  );

  const breakEnd = configService.get<string>('TRADING_BREAK_END_TIME', '13:00');

  // Current IST time
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }),
  );

  // ============================
  // Market hours check
  // ============================
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);

  const marketStart = new Date(now);
  marketStart.setHours(sh, sm, 0, 0);

  const marketEnd = new Date(now);
  marketEnd.setHours(eh, em, 0, 0);

  if (now < marketStart || now > marketEnd) {
    return false;
  }

  // ============================
  // Break time check (if enabled)
  // ============================
  if (breakEnabled) {
    const [bh, bm] = breakStart.split(':').map(Number);
    const [ehh, emm] = breakEnd.split(':').map(Number);

    const breakStartTime = new Date(now);
    breakStartTime.setHours(bh, bm, 0, 0);

    const breakEndTime = new Date(now);
    breakEndTime.setHours(ehh, emm, 0, 0);

    // ❌ Inside break window → block trading
    if (now >= breakStartTime && now <= breakEndTime) {
      console.log(
        `TradingTiming-Logic ⏸ Trading break time from ${breakStart} to ${breakEnd} IST`,
      );
      return false;
    }
  }

  // ✅ Allowed
  return true;
}
