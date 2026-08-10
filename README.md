# 🛡️ Yoda-Level GitHub Badge

Turn your GitHub activity into a cinematic, Shields-style **Rank** badge — with **granular sub-ranks (I–IV)**, a colorful **XP indicator**, **Jedi/Sith themes**, **streaks**, fun **Trials** (achievements), and shareable head-to-head **Duels**.

<p align="center">
  <a href="https://yoda-level-github-badge.vercel.app/api/user-rank?username=CosminBMemetea&badge=1&granular=1&showPoints=1&showNext=1&streak=1&logo=galaxy">
    <img alt="Rank" src="https://yoda-level-github-badge.vercel.app/api/user-rank?username=CosminBMemetea&badge=1&granular=1&showPoints=1&showNext=1&streak=1&logo=galaxy" />
  </a>
</p>

---

## ✨ Features

- **Auto-computed rank (0–100)** from GitHub activity (GraphQL preferred; REST fallback)
- **Granular sub-ranks** inside each tier: I → II → III → IV
- **XP indicator**: dots or bar, color-ramped by progress
- **Themes**: `jedi` (space-blue) or `sith` (crimson/black)
- **Streaks** (consecutive days with ≥1 contribution), computed from your contribution calendar, with an events-based fallback
- **Trials**: fun achievement badges based on your recent activity
- **Rank Duels**: shareable SVG posters for A vs B
- **Zero front-end required**: every endpoint returns SVG (or JSON if you want raw data)

---

## 🚀 Quick Start

Drop this in your GitHub profile README, swapping in your username:

```md
[![Rank](https://yoda-level-github-badge.vercel.app/api/user-rank?username=YOUR_USERNAME&badge=1&granular=1&showPoints=1&showNext=1&streak=1&logo=galaxy)](https://yoda-level-github-badge.vercel.app/api/user-rank?username=YOUR_USERNAME)
```

**Sith theme + XP bar:**

```md
[![Rank](https://yoda-level-github-badge.vercel.app/api/user-rank?username=YOUR_USERNAME&badge=1&granular=1&xp=bar&theme=sith&logo=saber)](https://yoda-level-github-badge.vercel.app/api/user-rank?username=YOUR_USERNAME)
```

**Rank Duel — you vs a friend:**

```md
[![Rank Duel](https://yoda-level-github-badge.vercel.app/api/duel?user1=YOUR_USERNAME&user2=THEIR_USERNAME&theme=jedi)](https://yoda-level-github-badge.vercel.app/api/duel?user1=YOUR_USERNAME&user2=THEIR_USERNAME&theme=jedi)
```

**Trials (achievements strip):**

```md
![Yoda Trials](https://yoda-level-github-badge.vercel.app/api/trials?username=YOUR_USERNAME&theme=jedi)
```

**Manual points badge (no GitHub calls):**

```md
![Rank](https://yoda-level-github-badge.vercel.app/api/badge?points=82.5&label=Rank&granular=1&xp=bar&showPoints=1&showNext=1&logo=galaxy)
```

> Replace the domain with your own deployment if you forked and redeployed this project.

---

## 🔌 Endpoints

### 1) `/api/user-rank` — Compute rank from GitHub

* **Method**: `GET`
* **Returns**: `SVG` when `badge=1`, otherwise `JSON`

**Core params**

| Param          | Type   | Default   | Description                                                       |
| -------------- | ------ | --------- | ------------------------------------------------------------------ |
| `username`     | string | —         | GitHub username (required)                                        |
| `badge`        | 0\|1   | `0`       | `1` → return SVG badge; `0` → JSON                                 |
| `label`        | string | `Rank`    | Left-side label                                                   |
| `logo`         | enum   | `saber`   | `galaxy` \| `saber` \| `github`                                    |
| `theme`        | enum   | `jedi`    | `jedi` \| `sith`                                                   |
| `granular`     | 0\|1   | `0`       | Show sub-rank I–IV inside the tier                                 |
| `xp`           | enum   | `dots`    | `dots` \| `bar` \| `none`                                          |
| `showPoints`   | 0\|1   | `0`       | Append score (e.g., `82.5 pts`)                                    |
| `showNext`     | 0\|1   | `0`       | Append delta to next tier (e.g., `+2.0 to Grand Master`)           |
| `streak`       | 0\|1   | `0`       | Show streak on the badge text                                     |
| `streakMode`   | enum   | `classic` | `classic` (consecutive days ≥1) \| `momentum` (2-day rolling window) |
| `streakSource` | enum   | `calendar`| `calendar` \| `events` \| `hybrid` (merges both, taking the max)   |
| `streakWindow` | number | `120`     | Days of history for streak calc (30–365)                           |

**JSON example**

```
/api/user-rank?username=CosminBMemetea
```

```json
{
  "username": "CosminBMemetea",
  "points": 73.4,
  "rank": "B",
  "persona": "Rebel Pilot",
  "color": "#8b5cf6",
  "method": "graphql",
  "streak": { "mode": "classic", "days": 5 },
  "granular": { "band": "II", "nextTier": "Rebel Commander", "pointsToNext": 1.6, "pctWithinTier": 41.2 },
  "tiers": [
    { "grade": "S++", "name": "Master Yoda", "min": 98 },
    ...
  ]
}
```

**SVG example**

```
/api/user-rank?username=torvalds&badge=1&granular=1&xp=bar&theme=sith&streak=1&logo=saber
```

---

### 2) `/api/badge` — Static/custom badge (no GitHub calls)

* **Method**: `GET`
* **Returns**: `SVG`

**Params**

| Param        | Type   | Default       | Description                                                  |
| ------------ | ------ | ------------- | -------------------------------------------------------------|
| `label`      | string | `Rank`        | Left-side text                                                |
| `persona`    | string | `Master Yoda` | Right persona (ignored if `points` is provided)                |
| `grade`      | string | `S++`         | Right grade (ignored if `points` is provided)                  |
| `points`     | number | —             | If provided, maps points→tier and fills persona/grade/color    |
| `granular`   | 0\|1   | `0`           | Show I–IV inside tier                                          |
| `xp`         | enum   | `dots`        | `dots` \| `bar` \| `none`                                      |
| `showPoints` | 0\|1   | `0`           | Append numeric points                                          |
| `showNext`   | 0\|1   | `0`           | Add distance to next tier                                      |
| `logo`       | enum   | `saber`       | `galaxy` \| `saber` \| `github`                                 |
| `theme`      | enum   | `jedi`        | `jedi` \| `sith`                                                |

**Example**

```
/api/badge?points=82.5&label=Rank&granular=1&xp=bar&showPoints=1&showNext=1&logo=galaxy
```

---

### 3) `/api/duel` — Head-to-head Rank Duel (shareable SVG poster)

* **Method**: `GET`
* **Returns**: `SVG` when `badge` isn't `0`, otherwise `JSON`

**Params**

| Param   | Type   | Default | Description                                             |
| ------- | ------ | ------- | -------------------------------------------------------- |
| `user1` | string | —       | First GitHub username (required; `u1` also works)        |
| `user2` | string | —       | Second GitHub username (required; `u2` also works)       |
| `theme` | enum   | `jedi`  | `jedi` \| `sith`                                          |
| `icon1` | enum   | `saber` | `github` \| `saber` \| `galaxy` \| `none` — left icon      |
| `icon2` | enum   | `galaxy`| `github` \| `saber` \| `galaxy` \| `none` — right icon     |
| `badge` | 0\|1   | `1`     | `0` → return JSON instead of SVG                          |

**Example**

```
/api/duel?user1=CosminBMemetea&user2=torvalds&theme=jedi
```

---

### 4) `/api/trials` — Achievement badges

* **Method**: `GET`
* **Returns**: `SVG` (icon strip or card grid), or `JSON` with `json=1`

**Params**

| Param          | Type   | Default      | Description                                              |
| -------------- | ------ | ------------ | ---------------------------------------------------------- |
| `username`     | string | —            | GitHub username (required)                                 |
| `theme`        | enum   | `jedi`       | `jedi` \| `sith`                                            |
| `detailed`     | 0\|1   | `0`          | `1` → multi-row card grid with descriptions; `0` → compact icon strip |
| `labels`       | 0\|1   | `0`          | Show short labels under icons in compact mode                |
| `cols`         | number | `3`          | Columns for the `detailed` card grid (1–4)                  |
| `title`        | string | `Yoda Trials`| Heading text                                                |
| `streakWindow` | number | `180`        | Days of history used for the streak-based trial (30–400)     |
| `json`         | 0\|1   | `0`          | `1` → return raw JSON instead of SVG                        |

Trials unlock based on recent activity: commits in the last 7/30 days, merged PRs, PR reviews, commit streaks, distinct issues opened, total stars, and reaching S-tier.

**Example**

```
/api/trials?username=CosminBMemetea&theme=jedi&detailed=1
```

---

## 🧮 Ranking System (0–100 → Persona)

* **S++**: Master Yoda (98–100)
* **S+**: Grand Master (≥96) • **S**: Jedi Master (≥94) • **S-**: Jedi Council (≥92) • **S--**: Sith Lord (≥90)
* **A+**: Obi-Wan Kenobi (≥85) • **A**: Jedi Knight (≥80)
* **B+**: Rebel Commander (≥75) • **B**: Rebel Pilot (≥70)
* **C+**: Padawan (≥65) • **C**: Youngling (≥60) • **C-**: Academy Cadet (≥55)
* **D+**: Frontier Scout (≥50) • **D**: Cantina Regular (≥45) • **D-**: Scrapyard Tech (≥40)
* **F+**: Moisture Farmer (≥30) • **F**: Force Beginner (≥0)

Sub-ranks inside each tier: **I** (entry) → **IV** (top).

---

## 🔐 Environment Variables

| Name           | Required    | Purpose                                                                                                                                                  |
| -------------- | :---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN` | Recommended | Enables GitHub **GraphQL** (richer metrics + 5,000 req/hr). Public-data scope is enough. Without it, the app falls back to REST with lower rate limits. |

**Vercel**: Project → *Settings → Environment Variables* → add `GITHUB_TOKEN`, redeploy.
**Local**: create `.env.local`:

```
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxx
```

---

## 🚀 Deployment (Vercel)

```bash
# install
npm i

# local dev
npm run dev

# build check
npm run build
```

* Push to GitHub.
* Import the repo into **Vercel**.
* Set `GITHUB_TOKEN` (optional but recommended).
* Vercel auto-builds when you push.

---

## 🧰 Implementation Notes

* **Edge Runtime** routes (`app/api/**/route.ts`) for fast cold starts.
* SVG is **XML-safe** (attributes/text escaped; decimals use `0.x` not `.x`).
* **Caching**: responses set `s-maxage` for CDN caching; add `&t=<nonce>` to bust caches if needed.
* **XP colors** ramp with progress: red → amber → lime → green (Sith palette adjusts hues).
* **Legend override**: obvious legends (e.g., `torvalds`) are clamped to 100 to ensure “Yoda (S++)”.

---

## 🛠 Troubleshooting

* **Broken SVG / XML error**: You're hitting a cached response. Re-deploy and add `&t=1` to the URL.
* **Streak looks wrong**: Hit `/api/streak-debug?username=YOUR_USERNAME` — it returns the raw per-day counts and computed streak so you can see exactly what's being counted. Without your own `GITHUB_TOKEN`, only public contributions are visible.
* **Module not found (`@/lib/...`)**:
  * Ensure `tsconfig.json` has:
    ```json
    { "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }
    ```
  * Or use relative imports like `../../../lib/rank`.
* **Rate limited / `"method":"rest"`**: Set `GITHUB_TOKEN` in env and redeploy.

---

## 📄 License

MIT — use anywhere, contributions welcome.

---

## 🙌 Credits

Built with Next.js App Router + Edge Functions. Star Wars-inspired styling for fun; not affiliated with Lucasfilm/Disney. GitHub data via REST/GraphQL APIs.
