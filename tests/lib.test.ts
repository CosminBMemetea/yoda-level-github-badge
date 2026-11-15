import { describe, expect, it } from 'vitest';
import { cleanText, isValidGitHubLogin, parseEnum, parseHexColor, parseIntClamped } from '@/lib/http';
import { pickTierByPoints, textWidth, tierWithBand } from '@/lib/rank';
import { scoreFromREST } from '@/lib/score';
import { computeClassicStreak, fromEvents, normalizeDays } from '@/lib/streak';
import { buildBadgeSVG } from '@/lib/badge';
import { ymd } from './helpers';

describe('input validation', () => {
  it('accepts real GitHub logins and rejects everything else', () => {
    for (const ok of ['octocat', 'CosminBMemetea', 'a', 'a-b-c', 'x'.repeat(39)]) {
      expect(isValidGitHubLogin(ok)).toBe(true);
    }
    for (const bad of ['', '-lead', 'trail-', 'dou--ble', 'x'.repeat(40), '../etc', 'a b', 'a/b', '<svg>']) {
      expect(isValidGitHubLogin(bad)).toBe(false);
    }
  });

  it('only accepts hex colors', () => {
    expect(parseHexColor('ff0000')).toBe('#ff0000');
    expect(parseHexColor('#ABC')).toBe('#abc');
    expect(parseHexColor('red')).toBeNull();
    expect(parseHexColor('#fff" onload="x')).toBeNull();
    expect(parseHexColor('url(javascript:alert(1))')).toBeNull();
  });

  it('caps free text and strips control characters', () => {
    expect(cleanText('a'.repeat(100), 'x', 10)).toHaveLength(10);
    expect(cleanText('\u0000\n  ', 'fallback')).toBe('fallback');
    expect(cleanText(null, 'Rank')).toBe('Rank');
  });

  it('parses enums and clamped integers defensively', () => {
    expect(parseEnum('sith', ['jedi', 'sith'] as const, 'jedi')).toBe('sith');
    expect(parseEnum('evil', ['jedi', 'sith'] as const, 'jedi')).toBe('jedi');
    expect(parseIntClamped('9999', 120, 30, 365)).toBe(365);
    expect(parseIntClamped('abc', 120, 30, 365)).toBe(120);
  });
});

describe('rank math', () => {
  it('reaches band IV at a perfect score and band I at a tier floor', () => {
    expect(tierWithBand(100).bandRoman).toBe('IV');
    expect(tierWithBand(70)).toMatchObject({ bandRoman: 'I', pctToNext: 0 });
    expect(tierWithBand(70).tier.grade).toBe('B');
  });

  it('never produces NaN tiers', () => {
    expect(pickTierByPoints(Number.NaN).grade).toBe('F');
    expect(tierWithBand(Number.NaN).pointsToNext).toBeTypeOf('number');
    expect(pickTierByPoints(Infinity).grade).toBe('S++');
  });

  it('measures emoji as one glyph', () => {
    expect(textWidth('🔥')).toBe(textWidth('x'));
  });
});

describe('scoring', () => {
  it('returns a finite score even with a malformed created_at', () => {
    const p = scoreFromREST({
      followers: 1,
      publicRepos: 1,
      createdAt: 'not-a-date',
      repos: [{ stargazers_count: 3, forks_count: 0, language: 'TS', pushed_at: 'garbage', updated_at: null }],
      events: [{ type: 'PushEvent', created_at: 'garbage' }]
    });
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
  });
});

describe('streak helpers', () => {
  it('ignores events without a timestamp instead of counting them as today', () => {
    const days = fromEvents([{ type: 'PushEvent' }, { type: 'PushEvent', created_at: 'nope' }], 30);
    expect(days.reduce((s, d) => s + d.count, 0)).toBe(0);
    expect(computeClassicStreak(days, 'today')).toBe(0);
  });

  it('counts consecutive days from events', () => {
    const iso = (n: number) => `${ymd(n)}T12:00:00Z`;
    const days = fromEvents([{ created_at: iso(0) }, { created_at: iso(1) }, { created_at: iso(3) }], 30);
    expect(computeClassicStreak(days, 'today')).toBe(2);
  });

  it('sums duplicate dates when normalizing', () => {
    const out = normalizeDays(
      [{ date: '2026-01-02', count: 2 }, { date: '2026-01-02', count: 3 }],
      '2026-01-01',
      '2026-01-03'
    );
    expect(out).toEqual([
      { date: '2026-01-01', count: 0 },
      { date: '2026-01-02', count: 5 },
      { date: '2026-01-03', count: 0 }
    ]);
  });
});

describe('SVG rendering', () => {
  it('escapes user-controlled text', () => {
    const { svg } = buildBadgeSVG({
      label: '<script>alert(1)</script>',
      rightText: '"><img src=x onerror=alert(1)>',
      rightColor: '#fff'
    });
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<img/i);
    expect(svg).toContain('&lt;SCRIPT&gt;');
  });
});
