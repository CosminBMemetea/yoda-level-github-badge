# Contributing

Thanks for helping the badge reach Master Yoda level! 🛡️

## Getting started

Requirements: Node.js 20.9+ (22 LTS recommended) and npm.

```bash
git clone https://github.com/CosminBMemetea/yoda-level-github-badge.git
cd yoda-level-github-badge
npm ci
cp .env.example .env.local   # optional: add a GITHUB_TOKEN
npm run dev                  # http://localhost:3000/ui
```

## Before you open a pull request

```bash
npm run typecheck   # TypeScript
npm test            # Vitest unit + route tests (GitHub is mocked, no token needed)
npm run build       # production build
```

CI runs the same commands on every pull request (once `.github/workflows/ci.yml` is added — see the PR that introduced this file).

## Project layout

| Path | What lives there |
| --- | --- |
| `app/api/*/route.ts` | One file per endpoint (`user-rank`, `badge`, `duel`, `trials`, `streak-debug`) |
| `app/ui/page.jsx` | The Badge Studio (live previews + copy Markdown) |
| `lib/http.ts` | Query-param validation, token handling, cache + security headers |
| `lib/github.ts` | GitHub REST/GraphQL calls |
| `lib/points.ts`, `lib/score.ts`, `lib/rank.ts` | Scoring and tier math |
| `lib/streak.ts`, `lib/activity.ts` | Streak calculation and its data sources |
| `lib/badge.ts` | SVG rendering |
| `tests/` | Vitest tests |

## Guidelines

- **Add a test** for every bug fix or new parameter (`tests/routes.test.ts` shows how to mock GitHub).
- **Validate and escape input.** Read query params through the helpers in `lib/http.ts` (`parseEnum`, `cleanText`, `parseHexColor`, `isValidGitHubLogin`) and escape any text that goes into SVG.
- **Keep responses cacheable** with `cacheHeaders()`, which handles the per-user-token case for you.
- Keep pull requests focused; one feature or fix per PR is easiest to review.
- Never commit tokens, `.env*` files, or personal data.

## Reporting bugs and ideas

Use the [issue templates](https://github.com/CosminBMemetea/yoda-level-github-badge/issues/new/choose). For security problems, follow [SECURITY.md](SECURITY.md) instead.
