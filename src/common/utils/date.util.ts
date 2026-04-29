import moment = require('moment-timezone');

export function getISTTradeDate(): string {
  return moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
}
