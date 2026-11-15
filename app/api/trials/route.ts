// app/api/trials/route.ts
import { themeColors } from '@/lib/theme';
import { fetchContributionCalendar, fetchEventsREST, fetchReposREST, fetchUserREST, MAX_CALENDAR_DAYS } from '@/lib/github';
import { computeUserPoints, describeError } from '@/lib/points';
import { tierWithBand } from '@/lib/rank';
import {
  fromContributionCalendar,
  normalizeDays,
  toYMDUTC,
  computeClassicStreak,
  mergeDaysMax,
  fromEvents
} from '@/lib/streak';
import {
  cacheHeaders,
  cleanText,
  errorResponse,
  isValidGitHubLogin,
  JSON_HEADERS,
  parseEnum,
  parseIntClamped,
  resolveToken,
  SVG_HEADERS
} from '@/lib/http';

export const dynamic = 'force-dynamic';

type Mode = 'svg' | 'json';

type Trial = {
  key: string;
  emoji: string;
  name: string;
  desc: string;
  unlocked: boolean;
  // Optional numbers for tooltips / debug
  stats?: Record<string, number | string>;
};

const esc = (s: string) =>
  (s || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');

/** Wrap text into max lines by character count (SVG-safe, no foreignObject). */
function wrapLines(text: string, maxChars: number, maxLines: number): { lines: string[]; truncated: boolean } {
  const words = (text || '').split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + (cur ? ' ' : '') + w).length <= maxChars) {
      cur = cur ? cur + ' ' + w : w;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  const truncated = lines.join(' ').length < (text || '').trim().length;
  if (truncated && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.length >= 3 ? last.slice(0, Math.max(0, maxChars - 1)).replace(/\s+$/, '') + '…' : '…';
  }
  return { lines, truncated };
}

/** Parse PR/Issue IDs from events to avoid double-counting.
 * Only count newly opened PRs/issues within the window.
 */
function parseEventKey(e: any): { kind: 'pr' | 'issue' | null; key?: string } {
  const type = e?.type;
  const repo = e?.repo?.name || e?.repo?.id;
  const action = e?.payload?.action;
  if (type === 'PullRequestEvent') {
    // Count only PRs that were opened (avoid counting updates to older PRs)
    if (action !== 'opened') return { kind: null };
    const num = e?.payload?.number ?? e?.payload?.pull_request?.number ?? e?.payload?.pullRequest?.number;
    if (repo && typeof num === 'number' && Number.isFinite(num)) return { kind: 'pr', key: `pr:${repo}#${num}` };
  }
  if (type === 'IssuesEvent') {
    // Count only issues that were opened
    if (action !== 'opened') return { kind: null };
    const num = e?.payload?.issue?.number ?? e?.payload?.number;
    if (repo && typeof num === 'number' && Number.isFinite(num)) return { kind: 'issue', key: `issue:${repo}#${num}` };
  }
  return { kind: null };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Inputs
  const mode: Mode = searchParams.get('json') === '1' ? 'json' : 'svg';
  const username = searchParams.get('username');
  if (!username) return errorResponse(400, 'Missing ?username=', mode === 'svg');
  if (!isValidGitHubLogin(username)) return errorResponse(400, 'Invalid GitHub username', mode === 'svg');

  const theme = parseEnum(searchParams.get('theme'), ['jedi', 'sith'] as const, 'jedi');
  const tc = themeColors(theme);

  // Layout params
  const detailed = searchParams.get('detailed') === '1';
  const title    = esc(cleanText(searchParams.get('title'), 'Yoda Trials', 40).toUpperCase());
  const showLabels = !detailed && searchParams.get('labels') === '1'; // compact labels optional
  const pad = 10;

  // Streak parameters (GitHub's calendar API cannot go back further than a year)
  const streakWindow = parseIntClamped(searchParams.get('streakWindow'), 180, 30, MAX_CALENDAR_DAYS);
  const anchor = parseEnum(searchParams.get('anchor'), ['today', 'lastActive'] as const, 'lastActive');

  // 🔐 Token via Authorization header or env
  const { token, fromHeader } = resolveToken(req);
  const caching = cacheHeaders(900, fromHeader);

  // ----- Data Gathering (more accurate) -----
  // 1) User + repos for followers/stars
  // 2) Points via GraphQL (preferred) else REST
  // 3) Commits and streak from GraphQL contribution calendar (UTC normalized)
  // 4) Distinct PRs / Issues from REST events within 30 days (approximate best-effort)

  let followers = 0;
  let totalStars = 0;
  let points = 0;
  let commits7d = 0;
  let commits30d = 0;
  let streak = 0;
  let distinctPRs30d = 0;
  let distinctIssues30d = 0;
  let mergedPRs30d = 0;
  let reviews30d = 0;
  let sourceUsed: 'calendar' | 'events' | 'hybrid' = 'events';

  try {
    // User + repos are required: a missing user / rate limit is a hard error.
    const [u, repos, events] = await Promise.all([
      fetchUserREST(username, token),
      fetchReposREST(username, token),
      fetchEventsREST(username, token)
    ]);

    followers = u?.followers ?? 0;
    totalStars = repos.reduce((s: number, r: any) => s + (r?.stargazers_count || 0), 0);

    // Points: same scoring as /api/user-rank so the two never disagree
    points = (await computeUserPoints(username, token, { user: u, repos, events })).points;

    // Contribution calendar (most accurate for commits/streak) + events fallback and hybrid streak
    const weeks = await fetchContributionCalendar(username, token, Math.max(120, streakWindow));
    const maxYMD   = toYMDUTC(new Date());
    const minYMD30 = toYMDUTC(new Date(Date.now() - 30 * 86400000));
    const minYMD7  = toYMDUTC(new Date(Date.now() - 7  * 86400000));
    const minYMDStreak = toYMDUTC(new Date(Date.now() - streakWindow * 86400000));

    // Calendar-derived
    let denseCal: { date: string; count: number }[] = [];
    if (weeks) {
      const calDays = fromContributionCalendar(weeks);
      const d30 = normalizeDays(calDays, minYMD30, maxYMD);
      const d7  = normalizeDays(calDays, minYMD7,  maxYMD);
      denseCal  = normalizeDays(calDays, minYMDStreak, maxYMD);
      commits30d = d30.reduce((s, d) => s + (d.count || 0), 0);
      commits7d  = d7.reduce((s, d) => s + (d.count || 0), 0);
    }

    // Events-derived (approximate, public-only)
    let denseEv: { date: string; count: number }[] = [];
    if (events.length) {
      const evDays = fromEvents(events, Math.max(120, streakWindow));
      denseEv = normalizeDays(evDays, minYMDStreak, maxYMD);
    }

    // Hybrid streak source selection
    let denseForStreak: { date: string; count: number }[] = [];
    if (denseCal.length && denseEv.length) {
      denseForStreak = mergeDaysMax(denseCal, denseEv);
      sourceUsed = 'hybrid';
    } else if (denseCal.length) {
      denseForStreak = denseCal;
      sourceUsed = 'calendar';
    } else if (denseEv.length) {
      denseForStreak = denseEv;
      sourceUsed = 'events';
      // Approximate commits from events if calendar missing
      const d30 = normalizeDays(denseForStreak, minYMD30, maxYMD);
      const d7  = normalizeDays(denseForStreak, minYMD7,  maxYMD);
      commits30d = d30.reduce((s, d) => s + (d.count || 0), 0);
      commits7d  = d7.reduce((s, d) => s + (d.count || 0), 0);
    }

    streak = computeClassicStreak(denseForStreak, anchor);

    // REST events → distinct PR/Issue counts for last 30 days (best-effort)
    {
      if (Array.isArray(events)) {
        const sinceMs = Date.now() - 30 * 86400000;
        const prKeys = new Set<string>();
        const issueKeys = new Set<string>();
        const prMergedKeys = new Set<string>();
        const reviewPrKeys = new Set<string>();

        for (const e of events) {
          // Skip events without a timestamp rather than treating them as "now".
          const raw = e?.created_at || e?.createdAt || e?.timestamp;
          const t = raw ? new Date(raw).getTime() : NaN;
          if (!Number.isFinite(t) || t < sinceMs) continue;
          const parsed = parseEventKey(e);
          if (parsed.kind === 'pr' && parsed.key) prKeys.add(parsed.key);
          if (parsed.kind === 'issue' && parsed.key) issueKeys.add(parsed.key);
          // Merged PRs via closed+merged PR events
          if (e?.type === 'PullRequestEvent' && (e?.payload?.action === 'closed')) {
            const pr = e?.payload?.pull_request || e?.payload?.pullRequest;
            const num = pr?.number ?? e?.payload?.number;
            const repo = e?.repo?.name || e?.repo?.id;
            if (repo && typeof num === 'number' && pr?.merged) prMergedKeys.add(`pr:${repo}#${num}`);
          }
          // Reviews via PullRequestReviewEvent (count distinct PRs reviewed)
          if (e?.type === 'PullRequestReviewEvent') {
            const pr = e?.payload?.pull_request || e?.payload?.pullRequest;
            const num = pr?.number ?? e?.payload?.number;
            const repo = e?.repo?.name || e?.repo?.id;
            if (repo && typeof num === 'number') reviewPrKeys.add(`pr:${repo}#${num}`);
          }
        }
        distinctPRs30d = prKeys.size;
        distinctIssues30d = issueKeys.size;
        mergedPRs30d = prMergedKeys.size;
        reviews30d = reviewPrKeys.size;
      }
    }
  } catch (err) {
    const { status, message } = describeError(err);
    return errorResponse(status, message, mode === 'svg');
  }

  // Tier for mastery trial
  const { tier } = tierWithBand(points);

  // ----- Trials (tuned thresholds, accurate counters) -----
  const trials: Trial[] = [
    {
      key: 'padawan',
      emoji: '🧑‍💻',
      name: 'Padawan Learner',
      desc: 'At least 1 commit in the last 7 days.',
      unlocked: commits7d >= 1,
      stats: { commits7d }
    },
    {
      key: 'merged-pr-knight',
      emoji: '✅',
      name: 'Merged PR Knight',
      desc: '2+ PRs merged in the last 30 days.',
      unlocked: mergedPRs30d >= 2,
      stats: { mergedPRs30d }
    },
    {
      key: 'review-sage',
      emoji: '📝',
      name: 'Review Sage',
      desc: 'Reviewed 3+ distinct PRs in 30 days.',
      unlocked: reviews30d >= 3,
      stats: { reviews30d }
    },
    {
      key: 'sith-survivor',
      emoji: '🔥',
      name: 'Sith Survivor',
      desc: 'Maintained a 7+ day commit streak.',
      unlocked: streak >= 7,
      stats: { streak }
    },
    {
      key: 'lightspeed',
      emoji: '⚡',
      name: 'Lightspeed Coder',
      desc: '50+ commits in the last 7 days.',
      unlocked: commits7d >= 50,
      stats: { commits7d }
    },
    {
      key: 'pr-knight',
      emoji: '🛡️',
      name: 'Pull Request Knight',
      desc: '3+ distinct PRs in 30 days.',
      unlocked: distinctPRs30d >= 3,
      stats: { prs30d: distinctPRs30d }
    },
    {
      key: 'bug-buster',
      emoji: '🛠️',
      name: 'Bug Buster',
      desc: '3+ distinct issues in 30 days.',
      unlocked: distinctIssues30d >= 3,
      stats: { issues30d: distinctIssues30d }
    },
    {
      key: 'star-forged',
      emoji: '⭐',
      name: 'Star Forged',
      desc: 'Total 100+ repository stars.',
      unlocked: totalStars >= 100,
      stats: { stars: totalStars }
    },
    {
      key: 'jedi-mastery',
      emoji: '🧙',
      name: 'Jedi Mastery',
      desc: 'Reached S-tier (≥90 points).',
      unlocked: points >= 90 || tier.grade.startsWith('S'),
      stats: { points, grade: tier.grade }
    }
  ];

  // ETag helper (FNV-1a 32-bit, weak)
  const etag = (s: string) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'W/"' + (h >>> 0).toString(16) + '"';
  };

  // Conditional GET support. Headers are identical for 200 and 304.
  const respondWithEtag = (body: string, contentHeaders: Record<string, string>) => {
    const tag = etag(body);
    const headers = { ...contentHeaders, ...caching, 'ETag': tag, 'Vary': 'Authorization, If-None-Match' };
    if (req.headers.get('if-none-match') === tag) return new Response(null, { status: 304, headers });
    return new Response(body, { headers });
  };

  if (mode === 'json') {
    const bodyObj = {
      username,
      followers,
      totalStars,
      points,
      commits7d,
      commits30d,
      streak,
      prs30d: distinctPRs30d,
      issues30d: distinctIssues30d,
      mergedPRs30d,
      reviews30d,
      sourceUsed,
      trials
    };
    return respondWithEtag(JSON.stringify(bodyObj), JSON_HEADERS);
  }

  // ------------- SVG RENDERING (overflow-proof) -------------
  // Two modes:
  //  - detailed cards: multi-row grid, wrapped descriptions, clipped to cells
  //  - compact strip: icons only (optional tiny labels)
  const leftBg = tc.leftColor;

  if (detailed) {
    // Card grid layout (no overflow)
    const cols = Math.max(1, Math.min(4, parseInt(searchParams.get('cols') || '3', 10) || 3));
    const cellW = 260;           // wider cards to fit text
    const cellH = 78;            // taller to allow 2 lines of desc
    const gapX = 12, gapY = 12;
    const rows = Math.ceil(trials.length / cols);
    const width = pad * 2 + cols * cellW + (cols - 1) * gapX;
    const height = pad * 2 + 28 /*title*/ + rows * cellH + (rows - 1) * gapY;

    // Build cells
    let cells = '';
    trials.forEach((t, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = pad + c * (cellW + gapX);
      const y = pad + 28 + r * (cellH + gapY);

      const glow = t.unlocked ? (theme === 'sith' ? '#f97316' : '#22c55e') : '#6b7280';
      const nameFill = '#ffffff';
      const descFill = t.unlocked ? '#c7d2fe' : '#9ca3af';
      const badgeBg = t.unlocked ? (theme === 'sith' ? '#3b0a0a' : '#073b2a') : '#0f172a';

      // wrap desc to 2 lines of up to ~40 chars
      const wrapped = wrapLines(t.desc, 40, 2);

      const clipId = `clip-${i}`;
      const titleText = `${t.emoji} ${t.name}`;
      const tooltipStats = t.stats ? ' • ' + Object.entries(t.stats).map(([k, v]) => `${k}:${v}`).join(' ') : '';

      cells += `
        <defs>
          <clipPath id="${clipId}">
            <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="8"/>
          </clipPath>
        </defs>
        <g clip-path="url(#${clipId})">
          <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="10" fill="${badgeBg}" stroke="${glow}" stroke-opacity="${t.unlocked ? '0.8' : '0.25'}"/>
          <title>${esc(titleText)} — ${esc(t.desc)}${esc(tooltipStats)}</title>
          <!-- Title -->
          <text x="${x + 12}" y="${y + 24}" font-size="16" font-weight="700" font-family="Verdana, DejaVu Sans, Geneva, sans-serif" fill="${nameFill}">
            ${esc(titleText)}
          </text>
          <!-- Desc (wrapped to 2 lines) -->
          <text x="${x + 12}" y="${y + 42}" font-size="12" font-family="Verdana, DejaVu Sans, Geneva, sans-serif" fill="${descFill}">
            <tspan x="${x + 12}" dy="0">${esc(wrapped.lines[0] ?? '')}</tspan>
            ${wrapped.lines[1] ? `<tspan x="${x + 12}" dy="16">${esc(wrapped.lines[1])}</tspan>` : ''}
          </text>
        </g>
      `;
    });

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${title}">
  <title>${title} — Achievements</title>
  <defs>
    <linearGradient id="bg" x2="0" y2="1">
      <stop offset="0" stop-color="${esc(leftBg)}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.25"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" rx="10"/>
  <text x="${pad}" y="${pad + 16}" font-size="14" font-weight="700" font-family="Verdana, DejaVu Sans, Geneva, sans-serif" fill="#ffffff">${title}</text>
  ${cells}
</svg>`.trim();

    return respondWithEtag(svg, SVG_HEADERS);
  }

  // Compact strip (icons only) — optionally tiny labels without overflow
  {
    const gap = 6;
    const box = 36;
    const step = box + gap;
    const leftPad = 8;
    const width = leftPad * 2 + trials.length * step - gap;
    const height = showLabels ? 68 : 52;

    const icons = trials.map((t, i) => {
      const x = leftPad + i * step;
      const y = 8;
      const bg = t.unlocked ? (theme === 'sith' ? '#3b0a0a' : '#064e3b') : '#111827';
      const stroke = t.unlocked ? (theme === 'sith' ? '#f97316' : '#22c55e') : '#374151';
      const label = `${t.emoji} ${t.name}`;
      const clipId = `clip-mini-${i}`;

      // Optional one-line label under icon, truncated to 10 chars
      const smallName = t.name.length > 12 ? t.name.slice(0, 11) + '…' : t.name;

      return `
        <defs>
          <clipPath id="${clipId}">
            <rect x="${x}" y="${y}" width="${box}" height="${box}" rx="8"/>
          </clipPath>
        </defs>
        <g>
          <rect x="${x}" y="${y}" width="${box}" height="${box}" rx="8" fill="${bg}" stroke="${stroke}" stroke-opacity="${t.unlocked ? '0.8' : '0.25'}"/>
          <g clip-path="url(#${clipId})">
            <text x="${x + box/2}" y="${y + 23}" text-anchor="middle" font-size="18" font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">${esc(t.emoji)}</text>
          </g>
          <title>${esc(label)} — ${esc(t.desc)}</title>
          ${showLabels ? `
            <text x="${x + box/2}" y="${y + 48}" text-anchor="middle" font-size="10" font-family="Verdana, DejaVu Sans, Geneva, sans-serif" fill="#c7d2fe">${esc(smallName)}</text>
          ` : ''}
        </g>
      `;
    }).join('\n');

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${title}">
  <title>${title} — Compact</title>
  <defs>
    <linearGradient id="bg" x2="0" y2="1">
      <stop offset="0" stop-color="${esc(leftBg)}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.25"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" rx="10"/>
  ${icons}
</svg>`.trim();

    return respondWithEtag(svg, SVG_HEADERS);
  }
}
