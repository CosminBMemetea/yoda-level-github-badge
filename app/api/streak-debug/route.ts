// app/api/streak-debug/route.ts
import { computeClassicStreak, toYMDUTC } from '@/lib/streak';
import { loadStreakDays } from '@/lib/activity';
import { MAX_CALENDAR_DAYS } from '@/lib/github';
import {
  cacheHeaders,
  errorResponse,
  isValidGitHubLogin,
  jsonResponse,
  parseEnum,
  parseIntClamped,
  resolveToken
} from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Inspect your UTC-normalized per-day counts and the computed streak.
 *
 * Params:
 *   username (required)
 *   daysBack=180         : window size (30..365 — GitHub's calendar API max)
 *   anchor=today|lastActive (default lastActive)
 *   source=auto|calendar|events|hybrid  (default auto = calendar, falling back to events)
 *
 * Auth (optional):
 *   Send:  Authorization: Bearer <YOUR_GH_TOKEN>
 *   Responses made with your own token are never stored in shared caches.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const username = searchParams.get('username');
  if (!username) return errorResponse(400, 'Missing ?username=', false);
  if (!isValidGitHubLogin(username)) return errorResponse(400, 'Invalid GitHub username', false);

  const daysBack = parseIntClamped(searchParams.get('daysBack'), 180, 30, MAX_CALENDAR_DAYS);
  const anchor = parseEnum(searchParams.get('anchor'), ['today', 'lastActive'] as const, 'lastActive');
  const source = parseEnum(searchParams.get('source'), ['auto', 'calendar', 'events', 'hybrid'] as const, 'auto');

  const { token, fromHeader } = resolveToken(req);

  let result;
  try {
    result = await loadStreakDays(username, token, source === 'auto' ? 'calendar' : source, daysBack);
  } catch {
    return errorResponse(502, 'GitHub fetch failed (calendar/events)', false);
  }
  const dense = result.days;

  const calendarError =
    source !== 'events' && result.used === 'events'
      ? 'Contribution calendar unavailable (no token configured, rate-limited, or user not found); used public events instead.'
      : undefined;

  return jsonResponse({
    username,
    used: result.used,
    calendarError,
    note: 'Without a token, only public activity is visible. Public events only cover ~90 days.',
    anchorUsed: anchor,
    utcToday: toYMDUTC(new Date()),
    streak: computeClassicStreak(dense, anchor),
    streak_today: computeClassicStreak(dense, 'today'),
    streak_lastActive: computeClassicStreak(dense, 'lastActive'),
    daysBack,
    recent30: dense.slice(-30),
    fullWindow: dense
  }, { headers: cacheHeaders(300, fromHeader) });
}
