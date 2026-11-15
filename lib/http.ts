// lib/http.ts
// Shared request parsing + response helpers used by every API route.
import { buildBadgeSVG } from './badge';

/** GitHub logins: 1–39 chars, alphanumeric or single hyphens, no leading/trailing hyphen. */
const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export function isValidGitHubLogin(value: string | null | undefined): value is string {
  return typeof value === 'string' && GITHUB_LOGIN_RE.test(value);
}

/** Return `value` if it is one of `allowed`, otherwise `fallback`. */
export function parseEnum<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Parse an integer query param and clamp it to [min, max]. */
export function parseIntClamped(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Trim free text from the query string and cap its length so SVGs stay a sane size. */
export function cleanText(value: string | null, fallback: string, maxLen = 40): string {
  const s = (value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s) return fallback;
  const chars = Array.from(s); // don't split surrogate pairs (emoji)
  return chars.length > maxLen ? chars.slice(0, maxLen - 1).join('') + '…' : s;
}

/** Accept `#rgb`, `#rrggbb`, or the same without `#`. Anything else returns null. */
export function parseHexColor(value: string | null): string | null {
  if (!value) return null;
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/**
 * Token priority: `Authorization: Bearer|token <t>` header > GITHUB_TOKEN env.
 * `fromHeader` tells callers the response may contain data only that caller
 * may see, so it must never be stored in a shared cache.
 */
export function resolveToken(req: Request): { token?: string; fromHeader: boolean } {
  const authHeader = req.headers.get('authorization') ?? '';
  const parts = authHeader.trim().split(/\s+/);
  if (parts.length === 2) {
    const scheme = parts[0].toLowerCase();
    if ((scheme === 'bearer' || scheme === 'token') && parts[1]) {
      return { token: parts[1], fromHeader: true };
    }
  }
  const env = process.env.GITHUB_TOKEN?.trim();
  return { token: env || undefined, fromHeader: false };
}

/**
 * Cache-Control for a successful response. Requests authenticated with the
 * caller's own token are `private, no-store` so a CDN never serves one
 * user's (possibly private-contribution) data to someone else.
 */
export function cacheHeaders(sMaxAge: number, privateResponse: boolean): Record<string, string> {
  return {
    'Cache-Control': privateResponse
      ? 'private, no-store'
      : `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge}`,
    'Vary': 'Authorization'
  };
}

/** Headers for SVG responses: lock the document down if opened directly. */
export const SVG_HEADERS: Record<string, string> = {
  'Content-Type': 'image/svg+xml; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*'
};

export const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*'
};

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { ...JSON_HEADERS, ...init.headers }
  });
}

export function svgResponse(svg: string, headers: Record<string, string> = {}) {
  return new Response(svg, { status: 200, headers: { ...SVG_HEADERS, ...headers } });
}

/**
 * Error response. When the caller asked for an image we return a small red
 * SVG badge (HTTP 200, short cache) so READMEs show a readable message
 * instead of a broken image; JSON callers get the real status code.
 */
export function errorResponse(status: number, message: string, asSvg: boolean) {
  if (asSvg) {
    const { svg } = buildBadgeSVG({
      label: 'Rank',
      rightText: message,
      rightColor: '#9f1239',
      icon: 'saber'
    });
    return svgResponse(svg, {
      'Cache-Control': 'public, max-age=0, s-maxage=60',
      'X-Error-Status': String(status)
    });
  }
  return jsonResponse({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}
