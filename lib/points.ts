// lib/points.ts
// One place that turns a GitHub username into a 0..100 score.
import { fetchEventsREST, fetchReposREST, fetchUserMetricsGraphQL, fetchUserREST } from './github';
import { applyLegendOverride, scoreFromGraphQL, scoreFromREST } from './score';

export type UserPoints = {
  method: 'graphql' | 'rest';
  points: number;
  approxStars: number;
  approxFollowers: number;
};

/**
 * GraphQL (token) first, REST fallback. Throws GitHubError (404 / 429 / …)
 * when the user cannot be loaded. Every route uses this so the same user
 * always gets the same score (duel used to ignore recent events).
 */
export async function computeUserPoints(
  username: string,
  token: string | undefined,
  /** REST data the caller already loaded; avoids spending rate limit twice. */
  prefetched?: { user: any; repos: any[]; events: any[] }
): Promise<UserPoints> {
  const gql = await fetchUserMetricsGraphQL(username, token);
  if (gql) {
    return {
      method: 'graphql',
      points: applyLegendOverride(username, scoreFromGraphQL(gql), gql.totalStars, gql.followers),
      approxStars: gql.totalStars,
      approxFollowers: gql.followers
    };
  }

  const [u, repos, events] = prefetched
    ? [prefetched.user, prefetched.repos, prefetched.events]
    : await Promise.all([
        fetchUserREST(username, token),
        fetchReposREST(username, token),
        fetchEventsREST(username, token)
      ]);

  const points = scoreFromREST({
    followers: u?.followers ?? 0,
    publicRepos: u?.public_repos ?? 0,
    createdAt: u?.created_at ?? new Date().toISOString(),
    repos: repos.map((r: any) => ({
      stargazers_count: r?.stargazers_count ?? 0,
      forks_count: r?.forks_count ?? 0,
      language: r?.language ?? null,
      pushed_at: r?.pushed_at ?? null,
      updated_at: r?.updated_at ?? null
    })),
    events: events.map((e: any) => ({ type: e?.type, created_at: e?.created_at }))
  });

  const approxStars = repos.reduce((s: number, r: any) => s + (r?.stargazers_count || 0), 0);
  const approxFollowers = u?.followers ?? 0;
  return {
    method: 'rest',
    points: applyLegendOverride(username, points, approxStars, approxFollowers),
    approxStars,
    approxFollowers
  };
}

/** Map any thrown error to a status + message that is safe to show publicly. */
export function describeError(e: unknown): { status: number; message: string } {
  const err = e as { name?: string; status?: number; message?: string };
  if (err?.name === 'GitHubError' && typeof err.status === 'number') {
    return { status: err.status, message: err.message ?? 'GitHub request failed' };
  }
  return { status: 502, message: 'GitHub request failed' };
}
