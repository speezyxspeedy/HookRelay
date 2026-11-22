const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'set-cookie',
  'x-hookrelay-secret',
  'x-auth-token',
  'x-access-token',
]);

export function maskSecret(secret: string): string {
  if (!secret) return 'whsec_••••••••';
  const suffix = secret.slice(-4);
  const prefix = secret.startsWith('whsec_') ? 'whsec_' : '';
  return `${prefix}••••••••${suffix}`;
}

export function redactHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (
      SENSITIVE_HEADER_KEYS.has(lower) ||
      lower.includes('secret') ||
      lower.includes('token') ||
      lower.includes('password')
    ) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }
  return result;
}

export function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/whsec_[a-fA-F0-9]+/g, 'whsec_[REDACTED]').slice(0, 500);
  }
  return String(err).replace(/whsec_[a-fA-F0-9]+/g, 'whsec_[REDACTED]').slice(0, 500);
}
