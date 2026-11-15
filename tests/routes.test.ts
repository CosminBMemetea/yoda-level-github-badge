import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as badgeGET } from '@/app/api/badge/route';
import { GET as userRankGET } from '@/app/api/user-rank/route';
import { GET as duelGET } from '@/app/api/duel/route';
import { GET as trialsGET } from '@/app/api/trials/route';
import { GET as streakDebugGET } from '@/app/api/streak-debug/route';
import { mockGitHub, req, restUser, ymd } from './helpers';

beforeEach(() => {
  vi.stubEnv('GITHUB_TOKEN', '');
});

/** REST-only GitHub with one user that pushed today and yesterday. */
function restOnly(login = 'octocat') {
  return mockGitHub([
    { match: new RegExp(`/users/${login}/repos`), body: [{ stargazers_count: 4, forks_count: 1, language: 'TypeScript', pushed_at: new Date().toISOString() }] },
    { match: new RegExp(`/users/${login}/events/public`), body: [
      { type: 'PushEvent', created_at: `${ymd(0)}T10:00:00Z` },
      { type: 'PushEvent', created_at: `${ymd(1)}T10:00:00Z` }
    ] },
    { match: new RegExp(`/users/${login}$`), body: restUser(login) }
  ]);
}

describe('/api/badge', () => {
  it('escapes label text and ignores non-hex colors', async () => {
    const res = await badgeGET(req('/api/badge?label=%3Cscript%3Ealert(1)%3C%2Fscript%3E&color=red%22%20onload%3D%22x'));
    const svg = await res.text();
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toContain('onload');
  });

  it('uses a valid explicit color', async () => {
    const svg = await (await badgeGET(req('/api/badge?color=ff0000'))).text();
    expect(svg).toContain('#ff0000');
  });

  it('honours showNext and the XP bar without granular=1', async () => {
    const svg = await (await badgeGET(req('/api/badge?points=72&showNext=1&xp=bar'))).text();
    expect(svg).toContain('TO REBEL COMMANDER');
    expect(svg).toMatch(/<rect x="\d+" y="25" width="\d+" height="3"/);
  });

  it('caps very long labels', async () => {
    const res = await badgeGET(req(`/api/badge?label=${'A'.repeat(5000)}`));
    const width = Number(/width="(\d+)"/.exec(await res.text())?.[1]);
    expect(width).toBeLessThan(800);
  });
});

describe('/api/user-rank', () => {
  it('returns an SVG error badge (not JSON) when badge=1 and username is missing', async () => {
    const res = await userRankGET(req('/api/user-rank?badge=1'));
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('x-error-status')).toBe('400');
    expect(await res.text()).toContain('MISSING ?USERNAME=');
  });

  it('rejects invalid usernames without calling GitHub', async () => {
    const { fetchMock } = mockGitHub([]);
    const res = await userRankGET(req('/api/user-rank?username=..%2F..%2Frate_limit'));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing user as 404', async () => {
    mockGitHub([]);
    const res = await userRankGET(req('/api/user-rank?username=ghost-user-xyz'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });

  it('reports rate limiting as 429 instead of "user not found"', async () => {
    mockGitHub([{ match: /api\.github\.com\/users\//, status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0' } }]);
    const res = await userRankGET(req('/api/user-rank?username=octocat'));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/rate limit/i);
  });

  it('falls back to public events for the streak when no token is configured', async () => {
    restOnly();
    const body = await (await userRankGET(req('/api/user-rank?username=octocat&streak=1'))).json();
    expect(body.method).toBe('rest');
    expect(body.streak).toMatchObject({ days: 2, source: 'events' });
  });

  it('never lets a shared cache store responses made with a caller token', async () => {
    const { calls } = restOnly();
    const res = await userRankGET(req('/api/user-rank?username=octocat', { Authorization: 'Bearer caller-token' }));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(calls.some(c => c.auth === 'Bearer caller-token')).toBe(true);
  });

  it('allows CDN caching for anonymous requests', async () => {
    restOnly();
    const res = await userRankGET(req('/api/user-rank?username=octocat'));
    expect(res.headers.get('cache-control')).toMatch(/^public/);
    expect(res.headers.get('vary')).toContain('Authorization');
  });

  it('falls back to defaults for unknown enum values', async () => {
    restOnly();
    const res = await userRankGET(req('/api/user-rank?username=octocat&badge=1&theme=%22%3E&logo=evil'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<svg');
  });
});

describe('/api/duel', () => {
  it('scores a user the same way /api/user-rank does', async () => {
    restOnly();
    const rank = await (await userRankGET(req('/api/user-rank?username=octocat'))).json();
    const duel = await (await duelGET(req('/api/duel?user1=octocat&user2=octocat&badge=0'))).json();
    expect(duel.a.points).toBe(rank.points);
    expect(duel.winner).toBe('tie');
  });

  it('validates both usernames', async () => {
    const res = await duelGET(req('/api/duel?user1=octocat&user2=%3Cx%3E&badge=0'));
    expect(res.status).toBe(400);
  });
});

describe('GitHub calendar window', () => {
  function withToken() {
    vi.stubEnv('GITHUB_TOKEN', 'server-token');
    return mockGitHub([
      { match: /graphql .*contributionsCollection\(from/, body: { data: { user: { contributionsCollection: { contributionCalendar: { weeks: [
        { contributionDays: [{ date: ymd(1), contributionCount: 1 }, { date: ymd(0), contributionCount: 2 }] }
      ] } } } } } },
      { match: /graphql/, body: { data: { user: null } } },
      { match: /\/users\/octocat\/repos/, body: [] },
      { match: /\/users\/octocat\/events/, body: [] },
      { match: /\/users\/octocat$/, body: restUser() }
    ]);
  }
  const spanDays = (body?: string) => {
    const v = JSON.parse(body ?? '{}').variables;
    return (Date.parse(v.to) - Date.parse(v.from)) / 86400000;
  };

  it('streak-debug never asks GitHub for more than a year', async () => {
    const { calls } = withToken();
    const body = await (await streakDebugGET(req('/api/streak-debug?username=octocat&daysBack=400'))).json();
    const cal = calls.find(c => c.body?.includes('contributionsCollection(from'));
    expect(spanDays(cal?.body)).toBeLessThanOrEqual(365);
    expect(body.used).toBe('calendar');
    expect(body.streak).toBe(2);
  });

  it('trials never asks GitHub for more than a year', async () => {
    const { calls } = withToken();
    const res = await trialsGET(req('/api/trials?username=octocat&streakWindow=400&json=1'));
    const body = await res.json();
    const cal = calls.find(c => c.body?.includes('contributionsCollection(from'));
    expect(spanDays(cal?.body)).toBeLessThanOrEqual(365);
    expect(body.commits7d).toBe(3);
  });
});

describe('/api/trials', () => {
  it('returns an SVG error badge for an unknown user', async () => {
    mockGitHub([]);
    const res = await trialsGET(req('/api/trials?username=ghost-user-xyz'));
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('x-error-status')).toBe('404');
  });

  it('supports conditional requests', async () => {
    restOnly();
    const first = await trialsGET(req('/api/trials?username=octocat'));
    const tag = first.headers.get('etag')!;
    restOnly();
    const second = await trialsGET(req('/api/trials?username=octocat', { 'If-None-Match': tag }));
    expect(second.status).toBe(304);
  });
});
