// lib/github.ts
// Minimal GitHub REST/GraphQL helpers (work in both Node and Edge runtimes).
const REST = 'https://api.github.com';
const GQL = 'https://api.github.com/graphql';

/** GitHub's contributionsCollection rejects ranges longer than one year. */
export const MAX_CALENDAR_DAYS = 365;

/** Error carrying an HTTP status the API routes can pass through to callers. */
export class GitHubError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'GitHubError';
  }
}

function ghHeaders(token?: string, extra: Record<string, string> = {}) {
  const h: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'yoda-level-github-badge',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Turn a non-OK GitHub REST response into a GitHubError with an honest message. */
function toGitHubError(r: Response, what: string): GitHubError {
  if (r.status === 404) return new GitHubError('GitHub user not found', 404);
  const rateLimited =
    r.status === 429 ||
    (r.status === 403 && (r.headers.get('x-ratelimit-remaining') === '0' || r.headers.has('retry-after')));
  if (rateLimited) {
    return new GitHubError('GitHub API rate limit exceeded, try again later', 429);
  }
  if (r.status === 401) return new GitHubError('GitHub rejected the token (401)', 401);
  return new GitHubError(`GitHub ${what} request failed (${r.status})`, 502);
}

export async function fetchUserREST(username: string, token?: string) {
  const r = await fetch(`${REST}/users/${encodeURIComponent(username)}`, {
    headers: ghHeaders(token),
    cache: 'no-store'
  });
  if (!r.ok) throw toGitHubError(r, 'user');
  return r.json();
}

export async function fetchReposREST(username: string, token?: string) {
  const perPage = 100;
  const url = `${REST}/users/${encodeURIComponent(username)}/repos?per_page=${perPage}&sort=updated&direction=desc`;
  const r = await fetch(url, { headers: ghHeaders(token), cache: 'no-store' });
  if (!r.ok) throw toGitHubError(r, 'repos');
  const data = await r.json();
  return Array.isArray(data) ? data : []; // first 100 is enough for scoring
}

export async function fetchEventsREST(username: string, token?: string): Promise<any[]> {
  // Public events (GitHub keeps ~90 days / 300 events). Good heuristic for recent activity.
  try {
    const r = await fetch(`${REST}/users/${encodeURIComponent(username)}/events/public?per_page=100`, {
      headers: ghHeaders(token),
      cache: 'no-store'
    });
    if (!r.ok) return []; // events are best-effort
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export type GraphQLMetrics = {
  followers: number;
  totalStars: number;
  lastContributionAt?: string | null;
  commits: number;
  prContribs: number;
  issueContribs: number;
  reviewContribs: number;
  repoContribs: number;
};

export async function fetchUserMetricsGraphQL(username: string, token?: string): Promise<GraphQLMetrics | null> {
  if (!token) return null;
  const q = `
    query($login: String!) {
      user(login: $login) {
        followers { totalCount }
        repositories(ownerAffiliations: OWNER, isFork: false, first: 100, orderBy: {field: STARGAZERS, direction: DESC}) {
          nodes { stargazerCount }
        }
        contributionsCollection {
          totalCommitContributions
          totalPullRequestContributions
          totalIssueContributions
          totalPullRequestReviewContributions
          totalRepositoryContributions
          contributionCalendar {
            weeks {
              contributionDays { contributionCount date }
            }
          }
        }
      }
    }`;
  let data: any;
  try {
    const r = await fetch(GQL, {
      method: 'POST',
      headers: ghHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ query: q, variables: { login: username } }),
      cache: 'no-store'
    });
    if (!r.ok) return null; // caller falls back to REST
    data = await r.json();
  } catch {
    return null;
  }
  const u = data?.data?.user;
  if (!u?.contributionsCollection) return null;

  // lastContributionAt from most recent day with contributions
  let last: string | null = null;
  for (const w of u.contributionsCollection.contributionCalendar?.weeks ?? []) {
    for (const d of w.contributionDays ?? []) {
      if (d.contributionCount > 0) last = d.date;
    }
  }
  const totalStars = ((u.repositories?.nodes ?? []) as Array<{ stargazerCount: number }>)
    .reduce((s, n) => s + (n?.stargazerCount || 0), 0);

  const c = u.contributionsCollection;
  return {
    followers: u.followers?.totalCount ?? 0,
    totalStars,
    lastContributionAt: last,
    commits: c.totalCommitContributions ?? 0,
    prContribs: c.totalPullRequestContributions ?? 0,
    issueContribs: c.totalIssueContributions ?? 0,
    reviewContribs: c.totalPullRequestReviewContributions ?? 0,
    repoContribs: c.totalRepositoryContributions ?? 0,
  };
}

/**
 * Fetch the GitHub contribution calendar (daily counts) for a user
 * for the past `daysBack` days (default 120, capped at 365 because GitHub
 * rejects longer ranges). Requires a token (passed in or GITHUB_TOKEN);
 * returns null on any failure so callers can fall back to REST events.
 */
export async function fetchContributionCalendar(username: string, token?: string, daysBack = 120) {
  const auth = token || process.env.GITHUB_TOKEN;
  if (!auth) return null; // no token → caller should fallback to REST events

  const days = Math.max(1, Math.min(MAX_CALENDAR_DAYS, Math.floor(daysBack) || 120));
  const dayMs = 86400000;
  const to = new Date();
  const from = new Date(to.getTime() - days * dayMs);

  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  try {
    const resp = await fetch(GQL, {
      method: 'POST',
      headers: ghHeaders(auth, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        query,
        variables: { login: username, from: from.toISOString(), to: to.toISOString() }
      }),
      cache: 'no-store'
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const weeks = data?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
    if (!Array.isArray(weeks)) return null;
    return weeks as Array<{ contributionDays: Array<{ date: string; contributionCount: number }> }>;
  } catch {
    return null;
  }
}
