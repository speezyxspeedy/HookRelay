import crypto from 'crypto';

export function generateSigningSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

export function computeHmacSignature(
  secret: string,
  timestamp: string | number,
  rawBody: string
): string {
  const payload = `${String(timestamp)}.${rawBody}`;
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function buildSignatureHeader(
  secret: string,
  rawBody: string,
  timestampSeconds?: number
): { timestamp: string; signatureHeader: string; signatureHex: string } {
  const ts = String(timestampSeconds ?? Math.floor(Date.now() / 1000));
  const signatureHex = computeHmacSignature(secret, ts, rawBody);
  return {
    timestamp: ts,
    signatureHeader: `t=${ts},v1=${signatureHex}`,
    signatureHex,
  };
}

export interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

export function parseSignatureHeader(headerValue: string): ParsedSignatureHeader | null {
  if (!headerValue || typeof headerValue !== 'string') {
    return null;
  }

  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of headerValue.split(',')) {
    const [rawKey, ...rawRest] = part.trim().split('=');
    const key = rawKey?.trim();
    const val = rawRest.join('=').trim();
    if (!key || !val) continue;

    if (key === 't') {
      const parsed = Number(val);
      if (Number.isInteger(parsed) && parsed > 0) {
        timestamp = parsed;
      }
    } else if (key === 'v1') {
      if (/^[a-fA-F0-9]{64}$/.test(val)) {
        signatures.push(val.toLowerCase());
      }
    }
  }

  if (timestamp === null || signatures.length === 0) {
    return null;
  }

  return { timestamp, signatures };
}

export interface VerifySignatureOptions {
  toleranceSeconds?: number;
  nowSeconds?: number;
}

export interface VerifySignatureResult {
  valid: boolean;
  reason?: string;
  timestamp?: number;
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string,
  options: VerifySignatureOptions = {}
): VerifySignatureResult {
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!secret) {
    return { valid: false, reason: 'Missing signing secret' };
  }
  if (!signatureHeader) {
    return { valid: false, reason: 'Missing X-HookRelay-Signature header' };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { valid: false, reason: 'Malformed signature header format' };
  }

  if (toleranceSeconds > 0 && Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return {
      valid: false,
      reason: `Timestamp outside tolerance window (${toleranceSeconds}s)`,
      timestamp: parsed.timestamp,
    };
  }

  const expectedHex = computeHmacSignature(secret, parsed.timestamp, rawBody);
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  for (const candidate of parsed.signatures) {
    const candidateBuf = Buffer.from(candidate, 'hex');
    if (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      return { valid: true, timestamp: parsed.timestamp };
    }
  }

  return {
    valid: false,
    reason: 'Signature digest mismatch',
    timestamp: parsed.timestamp,
  };
}
