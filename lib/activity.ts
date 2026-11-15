// lib/activity.ts
// Loads the per-day activity series used for streaks, with fallbacks.
import { fetchContributionCalendar, fetchEventsREST, MAX_CALENDAR_DAYS } from './github';
import { fromContributionCalendar, fromEvents, mergeDaysMax, normalizeDays, toYMDUTC, type DayCount } from './streak';

export type StreakSource = 'calendar' | 'events' | 'hybrid';
export const STREAK_SOURCES = ['calendar', 'events', 'hybrid'] as const;

export type StreakDays = {
  days: DayCount[];
  /** Source actually used. Differs from the requested one after a fallback. */
  used: StreakSource | 'none';
};

/**
 * Build a dense UTC day series for the last `windowDays` days.
 *
 * - `calendar`: GraphQL contribution calendar (needs a token). Falls back to
 *   public events when the calendar is unavailable, so tokenless deployments
 *   no longer always report a 0-day streak.
 * - `events`: public REST events only (GitHub keeps ~90 days of them).
 * - `hybrid`: max of both per day.
 *
 * Pass `events` if you already fetched them to avoid a second request.
 */
export async function loadStreakDays(
  username: string,
  token: string | undefined,
  source: StreakSource,
  windowDays: number,
  prefetchedEvents?: any[]
): Promise<StreakDays> {
  const window = Math.max(1, Math.min(MAX_CALENDAR_DAYS, Math.floor(windowDays)));
  const minYMD = toYMDUTC(new Date(Date.now() - window * 86400000));
  const maxYMD = toYMDUTC(new Date());

  let byCal: DayCount[] | undefined;
  if (source !== 'events') {
    const weeks = await fetchContributionCalendar(username, token, window);
    if (weeks) byCal = normalizeDays(fromContributionCalendar(weeks), minYMD, maxYMD);
  }

  let byEvt: DayCount[] | undefined;
  const needEvents = source !== 'calendar' || !byCal;
  if (needEvents) {
    const events = prefetchedEvents ?? (await fetchEventsREST(username, token));
    byEvt = normalizeDays(fromEvents(events, window), minYMD, maxYMD);
  }

  if (byCal && byEvt) return { days: mergeDaysMax(byCal, byEvt), used: 'hybrid' };
  if (byCal) return { days: byCal, used: 'calendar' };
  if (byEvt) return { days: byEvt, used: 'events' };
  return { days: [], used: 'none' };
}
