import { vi } from 'vitest';

type Route = { match: RegExp; status?: number; body?: unknown; headers?: Record<string, string> };

/**
 * Stub global fetch with a tiny router over GitHub URLs. GraphQL requests
 * are matched against the `query` text so tests can tell the metrics and
 * calendar queries apart. Unmatched requests return 404.
 */
export function mockGitHub(routes: Route[]) {
  const calls: { url: string; body?: string; auth?: string }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, body, auth: headers.Authorization });
    const key = body ? `${url} ${body}` : url;
    const route = routes.find(r => r.match.test(key));
    if (!route) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json', ...route.headers }
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

export const ymd = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

export function restUser(login = 'octocat', extra: Record<string, unknown> = {}) {
  return { login, followers: 10, public_repos: 5, created_at: '2015-01-01T00:00:00Z', ...extra };
}

export const req = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { headers });
