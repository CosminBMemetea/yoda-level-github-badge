# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: **[Security → Report a vulnerability](https://github.com/CosminBMemetea/yoda-level-github-badge/security/advisories/new)**.

Include the affected endpoint, a request that reproduces the problem, and what an attacker could do with it. You should get a reply within 7 days. Once a fix ships, you'll be credited in the advisory unless you prefer otherwise.

## Supported versions

Only the latest `main` branch (and the public demo deployed from it) receives security fixes.

## How this project handles data

- The service only reads **public** GitHub profile data. It stores nothing: no database, no logs of usernames beyond your host's default request logs.
- `GITHUB_TOKEN` (server env) needs **no scopes** — use a fine-grained token with no repository access. It is only sent to `api.github.com`.
- You may send your own token in an `Authorization: Bearer …` header. Such responses are marked `Cache-Control: private, no-store` so a CDN never serves them to anyone else. Never put a token in a URL query string or in a README.
- All user-supplied text (usernames, labels, titles) is validated and XML-escaped before it reaches an SVG, and SVG responses carry a restrictive `Content-Security-Policy`.
