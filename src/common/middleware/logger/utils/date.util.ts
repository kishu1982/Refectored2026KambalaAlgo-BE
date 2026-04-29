import moment from "moment";


export function getISTTradeDate(): string {
  return moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
}
