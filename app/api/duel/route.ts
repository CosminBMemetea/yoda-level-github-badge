// app/api/duel/route.ts
import { tierWithBand, textWidth } from '@/lib/rank';
import { themeColors } from '@/lib/theme';
import { computeUserPoints, describeError } from '@/lib/points';
import {
  cacheHeaders,
  errorResponse,
  isValidGitHubLogin,
  jsonResponse,
  parseEnum,
  resolveToken,
  svgResponse
} from '@/lib/http';

export const dynamic = 'force-dynamic';

type Icon = 'github' | 'saber' | 'galaxy' | 'none';

const GH_LOGO_PATH =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38' +
  ' 0-.19-.01-.82-.01-1.49C3.73 14.91 3.27 13.73 3.27 13.73c-.36-.91-.88-1.15-.88-1.15' +
  ' -.72-.49.05-.48.05-.48.79.06 1.2.81 1.2.81.71 1.21 1.87.86 2.33.66.07-.52.28-.86.5-1.06' +
  ' -2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32' +
  ' 3.3 1.23.96-.27 1.98-.4 3-.41 1.02.01 2.04.14 3 .41 2.28-1.55 3.29-1.23 3.29-1.23.66 1.65.24 2.87.12 3.17' +
  ' .77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.93.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2' +
  ' 0 .21.15.46.55.38C13.71 14.53 16 11.54 16 8c0-4.42-3.58-8-8-8z';

const SABER_ICON = `
  <g transform="translate(0,0)">
    <rect x="0" y="6" width="8" height="6" rx="1.5" fill="#e5e7eb"/>
    <rect x="1" y="7" width="6" height="4" rx="1" fill="#9ca3af"/>
    <rect x="2" y="8" width="4" height="2" rx="1" fill="#4b5563"/>
    <rect x="8" y="7" width="2" height="4" rx="1" fill="#94a3b8"/>
    <rect x="10" y="6" width="6" height="6" rx="1.5" fill="#bbf7d0"/>
    <rect x="10" y="7" width="6" height="4" rx="1.2" fill="#34d399"/>
  </g>
`;
const GALAXY_ICON = `
  <g transform="translate(0,0)">
    <circle cx="6" cy="6" r="5.5" fill="none" stroke="#e5e7eb" stroke-width="1.5"/>
    <path d="M6 0 L6 12 M0 6 L12 6 M2.2 2.2 L9.8 9.8 M2.2 9.8 L9.8 2.2"
          stroke="#e5e7eb" stroke-width="1.2" stroke-linecap="round"/>
    <circle cx="6" cy="6" r="1.8" fill="#a7f3d0"/>
  </g>
`;

const esc = (s: string) =>
  (s || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');

function iconMarkup(icon: Icon) {
  if (icon === 'none') return '';
  if (icon === 'github') return `<path fill="#fff" d="${GH_LOGO_PATH}"/>`;
  if (icon === 'saber') return SABER_ICON;
  return GALAXY_ICON;
}

// Measure + fit helpers
function fitTextToWidth(s: string, max: number, bold = false): { text: string; width: number } {
  if (!s) return { text: '', width: 0 };
  let w = textWidth(s, bold ? 'bold' : 'normal');
  if (w <= max) return { text: s, width: w };
  // Ellipsize
  let cut = s.length;
  while (cut > 1) {
    const t = s.slice(0, cut) + '…';
    w = textWidth(t, bold ? 'bold' : 'normal');
    if (w <= max) return { text: t, width: w };
    cut--;
  }
  return { text: '…', width: textWidth('…', bold ? 'bold' : 'normal') };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const user1 = searchParams.get('user1') || searchParams.get('u1');
  const user2 = searchParams.get('user2') || searchParams.get('u2');

  // Options
  const badge = searchParams.get('badge') !== '0'; // default svg
  const theme = parseEnum(searchParams.get('theme'), ['jedi', 'sith'] as const, 'jedi');
  const ICONS = ['github', 'saber', 'galaxy', 'none'] as const;
  const icon1: Icon = parseEnum(searchParams.get('icon1'), ICONS, 'saber');
  const icon2: Icon = parseEnum(searchParams.get('icon2'), ICONS, 'galaxy');

  if (!user1 || !user2) return errorResponse(400, 'Missing ?user1=&user2=', badge);
  if (!isValidGitHubLogin(user1) || !isValidGitHubLogin(user2)) {
    return errorResponse(400, 'Invalid GitHub username', badge);
  }

  // Layout caps (prevent overflow while keeping readability)
  const PAD = 14;
  const HEIGHT = 56;                      // Taller for breathing room
  const SEP_W = 64;                       // VS area
  const ICON_W = (i: Icon) => (i === 'none' ? 0 : 18);
  const MIN_SIDE = 210;                   // min width per side
  const MAX_SIDE = 300;                   // max width per side before ellipsis

  const { token, fromHeader } = resolveToken(req);

  // Compute points/tiers
  let a: any, b: any;
  try {
    const [pa, pb] = await Promise.all([computeUserPoints(user1, token), computeUserPoints(user2, token)]);
    a = { user: user1, ...pa, ...tierWithBand(pa.points) };
    b = { user: user2, ...pb, ...tierWithBand(pb.points) };
  } catch (e) {
    const { status, message } = describeError(e);
    return errorResponse(status, message, badge);
  }
  const caching = cacheHeaders(600, fromHeader);

  const winner =
    a.points === b.points ? 'tie' : (a.points > b.points ? 'left' : 'right');

  if (!badge) {
    return jsonResponse({
      a: { user: a.user, rank: a.tier.grade, persona: a.tier.name, band: a.bandRoman, points: a.points },
      b: { user: b.user, rank: b.tier.grade, persona: b.tier.name, band: b.bandRoman, points: b.points },
      winner
    }, { headers: caching });
  }

  // Compose labels (2 lines per side)
  const topL  = `${a.user.toUpperCase()}`;
  const botL  = `${a.tier.grade} • ${a.tier.name}`;
  const topR  = `${b.user.toUpperCase()}`;
  const botR  = `${b.tier.grade} • ${b.tier.name}`;

  // Fit to per-side max text widths
  const iconSpaceL = ICON_W(icon1) ? 20 : 0;
  const iconSpaceR = ICON_W(icon2) ? 20 : 0;

  // Max text area per side (cap)
  const MAX_TEXT_L = MAX_SIDE - PAD * 2 - iconSpaceL;
  const MAX_TEXT_R = MAX_SIDE - PAD * 2 - iconSpaceR;

  const fitTopL = fitTextToWidth(topL, MAX_TEXT_L, true);
  const fitBotL = fitTextToWidth(botL, MAX_TEXT_L, false);
  const fitTopR = fitTextToWidth(topR, MAX_TEXT_R, true);
  const fitBotR = fitTextToWidth(botR, MAX_TEXT_R, false);

  const sideW_L = Math.max(
    MIN_SIDE,
    Math.min(
      MAX_SIDE,
      PAD * 2 + iconSpaceL + Math.max(fitTopL.width, fitBotL.width)
    )
  );
  const sideW_R = Math.max(
    MIN_SIDE,
    Math.min(
      MAX_SIDE,
      PAD * 2 + iconSpaceR + Math.max(fitTopR.width, fitBotR.width)
    )
  );

  // sideW_L and sideW_R are each clamped to at most MAX_SIDE, so totalW can
  // never exceed 2*MAX_SIDE + SEP_W (664 < 720) — no further squeeze needed.
  const totalW = sideW_L + SEP_W + sideW_R;

  // Progress
  const prA = Math.max(0, Math.min(1, (a.pctToNext ?? 0) / 100));
  const prB = Math.max(0, Math.min(1, (b.pctToNext ?? 0) / 100));
  // Only the top tier is "maxed". (Previously pctToNext <= 0 was used, which is
  // also true at the very start of every tier, so e.g. exactly 70.0 pts drew a
  // full saber bar.)
  const maxedA = !a.nextTier;
  const maxedB = !b.nextTier;

  // Theme colors
  const tc = themeColors(theme);
  const leftColor = tc.leftColor;
  const rightShade = '#111827';

  // Winner ribbon
  const ribbonText = winner === 'tie' ? 'TIE' : 'WINNER';
  const ribbonFill = winner === 'tie' ? '#374151' : (winner === 'left' ? a.tier.color : b.tier.color);

  const saberBar = (x: number, w: number, pr: number, color: string, maxed: boolean) => {
    const core = Math.round((w - PAD * 2) * (maxed ? 1 : pr));
    return `
      <rect x="${x + PAD}" y="${HEIGHT - 9}" width="${w - PAD * 2}" height="5" rx="2.5" fill="#000000" opacity="0.28"/>
      <rect x="${x + PAD}" y="${HEIGHT - 9}" width="${core}" height="5" rx="2.5" fill="${esc(color)}" opacity="${maxed? '1' : '0.95'}"/>
    `;
  };

  const glowLeft = winner === 'left' ? `
    <rect x="0" y="0" width="${sideW_L}" height="${HEIGHT}" fill="${esc(a.tier.color)}" opacity="0.07"/>
  ` : '';
  const glowRight = winner === 'right' ? `
    <rect x="${sideW_L + SEP_W}" y="0" width="${sideW_R}" height="${HEIGHT}" fill="${esc(b.tier.color)}" opacity="0.07"/>
  ` : '';

  const iconL = iconMarkup(icon1);
  const iconR = iconMarkup(icon2);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${HEIGHT}" role="img"
     aria-label="Duel: ${esc(a.user)} vs ${esc(b.user)} — ${ribbonText}">
  <title>Duel • ${esc(a.user)} vs ${esc(b.user)} — ${ribbonText}</title>
  <defs>
    <linearGradient id="g" x2="0" y2="100%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.10"/>
    </linearGradient>
    <mask id="round"><rect width="${totalW}" height="${HEIGHT}" rx="8" fill="#fff"/></mask>
  </defs>

  <g mask="url(#round)">
    <rect width="${sideW_L}" height="${HEIGHT}" fill="${esc(leftColor)}"/>
    <rect x="${sideW_L}" width="${SEP_W}" height="${HEIGHT}" fill="#0b1020"/>
    <rect x="${sideW_L + SEP_W}" width="${sideW_R}" height="${HEIGHT}" fill="${rightShade}" opacity="0.18"/>
    ${glowLeft}
    ${glowRight}
    <rect width="${totalW}" height="${HEIGHT}" fill="url(#g)"/>
  </g>

  <!-- Winner ribbon -->
  <g transform="translate(${sideW_L},0)">
    <rect x="${(SEP_W/2) - 30}" y="6" width="60" height="14" rx="7" fill="${esc(ribbonFill)}" opacity="0.95"/>
    <text x="${SEP_W/2}" y="17" text-anchor="middle"
          font-family="Verdana, DejaVu Sans, Geneva, sans-serif"
          font-size="10" font-weight="700" fill="#ffffff">${ribbonText}</text>
    <text x="${SEP_W/2}" y="34" text-anchor="middle"
          font-family="Verdana, DejaVu Sans, Geneva, sans-serif"
          font-size="14" font-weight="700" fill="#e5e7eb">VS</text>
  </g>

  <!-- Left -->
  ${icon1 === 'none' ? '' : `<g transform="translate(${8},6)">${iconL}</g>`}
  <text x="${(icon1 === 'none' ? PAD : PAD + 20)}" y="20"
        font-family="Verdana, DejaVu Sans, Geneva, sans-serif"
        font-size="13" font-weight="700" fill="#ffffff">${esc(fitTopL.text)}</text>
  <text x="${(icon1 === 'none' ? PAD : PAD + 20)}" y="36"
        font-family="Verdana, DejaVu Sans, Geneva, sans-serif"
        font-size="11" fill="${esc(a.tier.color)}" opacity="0.95">${esc(fitBotL.text)}</text>
  ${saberBar(0, sideW_L, prA, a.tier.color, maxedA)}
  ${winner === 'left' ? `
    <text x="${sideW_L - 16}" y="16" text-anchor="end"
          font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji"
          font-size="14">👑</text>` : ''}

  <!-- Right -->
  ${icon2 === 'none' ? '' : `<g transform="translate(${sideW_L + SEP_W + 8},6)">${iconR}</g>`}
  <text x="${sideW_L + SEP_W + (icon2 === 'none' ? PAD : PAD + 20)}" y="20"
        font-family="Verdana, DejaVu Sans, Geneva, sans-serif"
        font-size="13" font-weight="700" fill="#ffffff">${esc(fitTopR.text)}</text>
  <text x="${sideW_L + SEP_W + (icon2 === 'none' ? PAD : PAD + 20)}" y="36"
        font-family="Verdana, DejaVu Sans, Geneva, sans-serif"
        font-size="11" fill="${esc(b.tier.color)}" opacity="0.95">${esc(fitBotR.text)}</text>
  ${saberBar(sideW_L + SEP_W, sideW_R, prB, b.tier.color, maxedB)}
  ${winner === 'right' ? `
    <text x="${totalW - 8}" y="16" text-anchor="end"
          font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji"
          font-size="14">👑</text>` : ''}
</svg>`.trim();

  return svgResponse(svg, caching);
}
