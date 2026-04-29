import * as crypto from 'crypto';

export function generateChecksum(
  clientId: string,
  secretKey: string,
  code: string,
): string {
  const raw = `${clientId}${secretKey}${code}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}
