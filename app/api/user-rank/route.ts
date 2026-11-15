// app/api/user-rank/route.ts
import { TIERS, tierWithBand } from '@/lib/rank';
import { buildBadgeSVG } from '@/lib/badge';
import { computeClassicStreak, computeMomentumStreak } from '@/lib/streak';
import { loadStreakDays, STREAK_SOURCES } from '@/lib/activity';
import { computeUserPoints, describeError } from '@/lib/points';
import {
  cacheHeaders,
  cleanText,
  errorResponse,
  isValidGitHubLogin,
  jsonResponse,
  parseEnum,
  parseIntClamped,
  resolveToken,
  svgResponse
} from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const badge = searchParams.get('badge') === '1';

  const username = searchParams.get('username');
  if (!username) return errorResponse(400, 'Missing ?username=', badge);
  if (!isValidGitHubLogin(username)) return errorResponse(400, 'Invalid GitHub username', badge);

  const label = cleanText(searchParams.get('label'), 'Rank', 24);
  const logo = parseEnum(searchParams.get('logo'), ['github', 'saber', 'galaxy'] as const, 'saber');
  const theme = parseEnum(searchParams.get('theme'), ['jedi', 'sith'] as const, 'jedi');

  const granular   = searchParams.get('granular') === '1';
  const showPoints = searchParams.get('showPoints') === '1';
  const showNext   = searchParams.get('showNext') === '1';
  const xpParam    = parseEnum(searchParams.get('xp'), ['dots', 'bar', 'none'] as const, 'dots');

  // Streak controls
  const showStreak     = searchParams.get('streak') === '1';
  const streakMode     = parseEnum(searchParams.get('streakMode'), ['classic', 'momentum'] as const, 'classic');
  const streakAnchor   = parseEnum(searchParams.get('streakAnchor'), ['today', 'lastActive'] as const, 'lastActive');
  const streakDaysBack = parseIntClamped(searchParams.get('streakWindow'), 120, 30, 365);
  const streakSource   = parseEnum(searchParams.get('streakSource'), STREAK_SOURCES, 'calendar');

  const { token, fromHeader } = resolveToken(req);

  let result;
  try {
    result = await computeUserPoints(username, token);
  } catch (e) {
    const { status, message } = describeError(e);
    return errorResponse(status, message, badge);
  }
  const { points, method } = result;

  const { tier, bandRoman, nextTier, pointsToNext, pctToNext } = tierWithBand(points);
  const progressRatio = Math.max(0, Math.min(1, (pctToNext ?? 0) / 100));

  // STREAK (best-effort: a failure hides the streak instead of failing the badge)
  let streakDays: number | undefined;
  let streakSourceUsed: string | undefined;
  if (showStreak) {
    try {
      const { days, used } = await loadStreakDays(username, token, streakSource, streakDaysBack);
      streakSourceUsed = used;
      streakDays =
        streakMode === 'momentum'
          ? computeMomentumStreak(days)
          : computeClassicStreak(days, streakAnchor);
    } catch {
      streakDays = undefined;
    }
  }

  // Right-side text
  const parts = [granular ? `${tier.name} (${tier.grade}) • ${bandRoman}` : `${tier.name} (${tier.grade})`];
  if (showPoints) parts.push(`${points.toFixed(1)} pts`);
  if (showNext && nextTier && pointsToNext !== undefined) parts.push(`+${pointsToNext.toFixed(1)} to ${nextTier.name}`);
  if (showStreak && typeof streakDays === 'number') parts.push(`🔥 ${streakDays}d streak`);
  const rightText = parts.join(' • ');

  // 🎖️ Maxed-out decoration for Yoda / S++
  const isMaxed = tier.grade === 'S++';
  const caching = cacheHeaders(1200, fromHeader);

  if (badge) {
    const { svg } = buildBadgeSVG({
      label,
      rightText,
      rightColor: tier.color,
      icon: logo,
      progressRatio: xpParam === 'none' ? undefined : (isMaxed ? 1 : progressRatio),
      progressVariant: xpParam === 'bar' ? 'bar' : 'dots',
      theme,
      decorateMaxed: isMaxed
    });
    return svgResponse(svg, caching);
  }

  return jsonResponse({
    username,
    points,
    rank: tier.grade,
    persona: tier.name,
    color: tier.color,
    method,
    streak: showStreak ? { mode: streakMode, days: streakDays, source: streakSourceUsed } : undefined,
    granular: { band: bandRoman, nextTier: nextTier?.name, pointsToNext, pctWithinTier: pctToNext },
    tiers: TIERS.map(t => ({ grade: t.grade, name: t.name, min: t.min }))
  }, { headers: caching });
}
