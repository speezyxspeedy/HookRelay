import dns from 'dns/promises';
import net from 'net';

export interface UrlValidationOptions {
  allowLocalhost: boolean;
  skipDnsLookup?: boolean;
}

export interface UrlValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  resolvedIps?: string[];
  error?: string;
}

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  '169.254.169.254',
]);

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) | (Number(octet) & 0xff)) >>> 0, 0);
}

function inIpv4Cidr(ip: string, cidrBase: string, prefixLen: number): boolean {
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(cidrBase) & mask);
}

function extractIpv4FromMappedIpv6(normalized: string): string | null {
  if (!normalized.startsWith('::ffff:')) return null;
  const tail = normalized.slice(7);
  if (net.isIPv4(tail)) return tail;
  const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (!hexMatch) return null;
  const hi = parseInt(hexMatch[1], 16);
  const lo = parseInt(hexMatch[2], 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function isLoopbackIp(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  const mappedIpv4 = extractIpv4FromMappedIpv6(normalized);
  if (mappedIpv4) return inIpv4Cidr(mappedIpv4, '127.0.0.0', 8);
  if (net.isIPv4(normalized)) {
    return inIpv4Cidr(normalized, '127.0.0.0', 8);
  }
  return false;
}

export function classifyIpAddress(ip: string): { blocked: boolean; reason?: string; isLoopback: boolean } {
  const normalized = ip.toLowerCase().trim();

  const mappedIpv4 = extractIpv4FromMappedIpv6(normalized);
  if (mappedIpv4) {
    return classifyIpAddress(mappedIpv4);
  }

  if (net.isIPv4(normalized)) {
    if (inIpv4Cidr(normalized, '127.0.0.0', 8)) {
      return { blocked: true, reason: 'Loopback address (127.0.0.0/8)', isLoopback: true };
    }
    if (inIpv4Cidr(normalized, '169.254.0.0', 16)) {
      return { blocked: true, reason: 'Link-local / cloud metadata address (169.254.0.0/16)', isLoopback: false };
    }
    if (inIpv4Cidr(normalized, '10.0.0.0', 8)) {
      return { blocked: true, reason: 'Private network address (10.0.0.0/8)', isLoopback: false };
    }
    if (inIpv4Cidr(normalized, '172.16.0.0', 12)) {
      return { blocked: true, reason: 'Private network address (172.16.0.0/12)', isLoopback: false };
    }
    if (inIpv4Cidr(normalized, '192.168.0.0', 16)) {
      return { blocked: true, reason: 'Private network address (192.168.0.0/16)', isLoopback: false };
    }
    if (inIpv4Cidr(normalized, '100.64.0.0', 10)) {
      return { blocked: true, reason: 'Carrier-grade NAT address (100.64.0.0/10)', isLoopback: false };
    }
    if (inIpv4Cidr(normalized, '0.0.0.0', 8)) {
      return { blocked: true, reason: 'Unspecified network address (0.0.0.0/8)', isLoopback: false };
    }
    if (inIpv4Cidr(normalized, '224.0.0.0', 4) || inIpv4Cidr(normalized, '240.0.0.0', 4)) {
      return { blocked: true, reason: 'Multicast or reserved IPv4 range', isLoopback: false };
    }
    if (inIpv4Cidr(normalized, '192.0.0.0', 24) || inIpv4Cidr(normalized, '198.18.0.0', 15)) {
      return { blocked: true, reason: 'Reserved special-use IPv4 range', isLoopback: false };
    }
    return { blocked: false, isLoopback: false };
  }

  if (net.isIPv6(normalized)) {
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
      return { blocked: true, reason: 'IPv6 loopback address (::1)', isLoopback: true };
    }
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') {
      return { blocked: true, reason: 'Unspecified IPv6 address (::)', isLoopback: false };
    }
    if (
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return { blocked: true, reason: 'IPv6 link-local address (fe80::/10)', isLoopback: false };
    }
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return { blocked: true, reason: 'IPv6 unique local / private address (fc00::/7)', isLoopback: false };
    }
    if (normalized.startsWith('ff')) {
      return { blocked: true, reason: 'IPv6 multicast address (ff00::/8)', isLoopback: false };
    }
    return { blocked: false, isLoopback: false };
  }

  return { blocked: true, reason: 'Unrecognized IP address format', isLoopback: false };
}

function isIpAllowed(ip: string, allowLocalhost: boolean): { allowed: boolean; reason?: string } {
  const classification = classifyIpAddress(ip);
  if (!classification.blocked) {
    return { allowed: true };
  }
  if (classification.isLoopback && allowLocalhost) {
    return { allowed: true };
  }
  return { allowed: false, reason: classification.reason };
}

export async function validateDestinationUrl(
  rawUrl: string,
  options: UrlValidationOptions
): Promise<UrlValidationResult> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'Destination URL is required' };
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return { valid: false, error: 'Destination URL exceeds maximum length of 2048 characters' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only http:// and https:// webhook URLs are permitted' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Webhook URLs must not contain embedded credentials' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    return { valid: false, error: 'URL must include a valid hostname' };
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    return { valid: false, error: `Destination hostname "${hostname}" is blocked for security` };
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    if (!options.allowLocalhost) {
      return {
        valid: false,
        error: 'Localhost webhook targets are disabled. Enable ALLOW_LOCALHOST_WEBHOOKS in development mode to test locally.',
      };
    }
    return { valid: true, normalizedUrl: parsed.toString(), resolvedIps: ['127.0.0.1'] };
  }

  if (net.isIP(hostname)) {
    const check = isIpAllowed(hostname, options.allowLocalhost);
    if (!check.allowed) {
      return { valid: false, error: `Blocked IP destination: ${check.reason}` };
    }
    return { valid: true, normalizedUrl: parsed.toString(), resolvedIps: [hostname] };
  }

  if (options.skipDnsLookup) {
    return { valid: true, normalizedUrl: parsed.toString(), resolvedIps: [] };
  }

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records || records.length === 0) {
      return { valid: false, error: `Hostname "${hostname}" could not be resolved via DNS` };
    }

    const ips: string[] = [];
    for (const record of records) {
      const check = isIpAllowed(record.address, options.allowLocalhost);
      if (!check.allowed) {
        return {
          valid: false,
          error: `Hostname "${hostname}" resolved to blocked address ${record.address}: ${check.reason}`,
        };
      }
      ips.push(record.address);
    }

    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      resolvedIps: ips,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'DNS resolution failed';
    return { valid: false, error: `Unable to resolve destination host "${hostname}": ${msg}` };
  }
}
