import crypto from 'crypto';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';

const CLAIMED_KEY_SETTING = 'auth_admin_key_hash';
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

// Ephemeral server-side key for signing short-lived Bearer dashboard session tokens.
const SESSION_SIGNING_SECRET = crypto.randomBytes(32);

export function hashApiKey(secret: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, salt, 32).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyHashedApiKey(secret: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(secret, salt, 32);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Compare against dummy buffer of same length to keep work constant-ish
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getClaimedKeyHash(db: HookRelayDB): string | null {
  const row = db
    .prepare('SELECT value FROM application_settings WHERE key = ?')
    .get(CLAIMED_KEY_SETTING) as { value: string } | undefined;
  return row?.value ?? null;
}

export function isSetupRequired(db: HookRelayDB, config: AppConfig): boolean {
  if (config.apiKey && config.apiKey.length > 0) {
    return false;
  }
  return getClaimedKeyHash(db) === null;
}

export function claimInitialAdminKey(
  db: HookRelayDB,
  config: AppConfig,
  chosenKey: string
): { ok: boolean; error?: string } {
  if (config.apiKey && config.apiKey.length > 0) {
    return { ok: false, error: 'HOOKRELAY_API_KEY is already configured in server environment.' };
  }
  if (!chosenKey || chosenKey.trim().length < 8) {
    return { ok: false, error: 'Admin API key must be at least 8 characters long.' };
  }
  if (chosenKey.trim().length > 256) {
    return { ok: false, error: 'Admin API key is too long.' };
  }

  const hash = hashApiKey(chosenKey.trim());
  const now = new Date().toISOString();

  // Atomic one-time insert so concurrent bootstrap attempts cannot overwrite an existing hash
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO application_settings (key, value, updated_at)
       VALUES (?, ?, ?)`
    )
    .run(CLAIMED_KEY_SETTING, hash, now);

  if (result.changes === 0) {
    return { ok: false, error: 'Workspace admin key has already been claimed.' };
  }
  return { ok: true };
}

export function verifyAdminCredential(
  db: HookRelayDB,
  config: AppConfig,
  candidate: string
): boolean {
  if (!candidate) return false;
  const trimmed = candidate.trim();

  // Configured environment variable always overrides any claimed fallback hash
  if (config.apiKey && config.apiKey.length > 0) {
    return timingSafeEqualString(trimmed, config.apiKey);
  }

  const storedHash = getClaimedKeyHash(db);
  if (!storedHash) {
    return false;
  }

  return verifyHashedApiKey(trimmed, storedHash);
}

export function createSessionToken(subject = 'admin'): { token: string; expiresAt: string } {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + SESSION_TTL_SECONDS;
  const payload = Buffer.from(
    JSON.stringify({ sub: subject, iat: nowSec, exp: expSec, jti: crypto.randomUUID() }),
    'utf8'
  ).toString('base64url');

  const sig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');

  return {
    token: `hrs_${payload}.${sig}`,
    expiresAt: new Date(expSec * 1000).toISOString(),
  };
}

export function verifySessionToken(token: string): boolean {
  if (!token || !token.startsWith('hrs_')) return false;
  const raw = token.slice(4);
  const dotIdx = raw.indexOf('.');
  if (dotIdx <= 0) return false;

  const payload = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  if (!payload || !sig) return false;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');

  if (!timingSafeEqualString(sig, expectedSig)) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (typeof decoded.exp !== 'number') return false;
    return Math.floor(Date.now() / 1000) < decoded.exp;
  } catch {
    return false;
  }
}

export function isRequestAuthenticated(
  db: HookRelayDB,
  config: AppConfig,
  apiKeyHeader: string | undefined,
  authHeader: string | undefined
): boolean {
  if (apiKeyHeader && verifyAdminCredential(db, config, apiKeyHeader)) {
    return true;
  }

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (verifySessionToken(token)) {
      return true;
    }
    if (verifyAdminCredential(db, config, token)) {
      return true;
    }
  }

  return false;
}
