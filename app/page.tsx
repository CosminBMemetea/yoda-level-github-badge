const RANK_EXAMPLE = '/api/badge?points=82.5&granular=1&xp=bar&showPoints=1&showNext=1&logo=galaxy';
const YODA_EXAMPLE = '/api/badge?points=99&logo=saber';
const SITH_EXAMPLE = '/api/badge?points=73&theme=sith&xp=bar&logo=github';

export default function Page() {
  return (
    <main className="container">
      <div className="card">
        <h1 className="h1">🛡️ Yoda-Level GitHub Badge</h1>
        <p className="sub">
          Star Wars–themed rank badges for your GitHub profile README: tiers, XP, streaks, trials and duels.
        </p>

        <p>
          <img src={RANK_EXAMPLE} alt="Example rank badge" /><br />
          <img src={YODA_EXAMPLE} alt="Example Master Yoda badge" /><br />
          <img src={SITH_EXAMPLE} alt="Example Sith-theme badge" />
        </p>

        <h3>Get yours</h3>
        <p>
          Open the <a href="/ui">Badge Studio</a>, type your GitHub username, and copy the Markdown into your profile README.
        </p>
        <p>Or paste this, replacing <code>YOUR_USERNAME</code> and this site&apos;s domain:</p>
        <pre><code>{'![Rank](https://<this-site>/api/user-rank?username=YOUR_USERNAME&badge=1&granular=1&xp=bar&streak=1)'}</code></pre>

        <h3>Endpoints</h3>
        <ul>
          <li><code>/api/user-rank</code> – rank computed from GitHub activity (SVG or JSON)</li>
          <li><code>/api/badge</code> – static/custom badge, no GitHub calls</li>
          <li><code>/api/duel</code> – head-to-head poster for two users</li>
          <li><code>/api/trials</code> – achievement strip</li>
          <li><code>/api/streak-debug</code> – raw per-day counts behind the streak</li>
        </ul>
        <p>
          Full parameter reference and self-hosting guide:{' '}
          <a href="https://github.com/CosminBMemetea/yoda-level-github-badge#readme">README on GitHub</a>.
        </p>
      </div>
    </main>
  );
}
