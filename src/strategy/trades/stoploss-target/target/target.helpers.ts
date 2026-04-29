import * as fs from 'fs';
import * as path from 'path';

const TARGET_DIR = path.join(process.cwd(), 'data/TVTargetTrack');

export function ensureTargetDir() {
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }
}

// 🔑 unified track key
export function getTargetTrackKey(token: string, entryOrderId: string): string {
  return `${token}_${entryOrderId}`;
}

export function readTargetTrack(trackKey: string): any[] {
  const file = path.join(TARGET_DIR, `${trackKey}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function appendTargetTrack(trackKey: string, payload: any) {
  ensureTargetDir();
  const file = path.join(TARGET_DIR, `${trackKey}.json`);
  const data = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : [];

  data.push({ ...payload, time: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function isTradeAlreadyClosed(track: any[]): boolean {
  return track.some((t) => t.action === 'TARGET_BOOKED_50_PERCENT');
}

export function countActionReason(
  track: any[],
  action: string,
  reason?: string,
): number {
  return track.filter(
    (t) => t.action === action && (reason ? t.reason === reason : true),
  ).length;
}

export function canAppendAction(
  track: any[],
  action: string,
  reason?: string,
  maxCount = 2,
): boolean {
  const count = track.filter(
    (t) => t.action === action && (reason ? t.reason === reason : true),
  ).length;

  return count < maxCount;
}
