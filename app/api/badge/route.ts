// app/api/badge/route.ts
// Static/custom badge — no GitHub calls.
import { clampPoints, pickTierByPoints, tierWithBand } from '@/lib/rank';
import { buildBadgeSVG } from '@/lib/badge';
import { cacheHeaders, cleanText, parseEnum, parseHexColor, svgResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const label      = cleanText(searchParams.get('label'), 'Rank', 24);
  const persona    = cleanText(searchParams.get('persona'), '', 32);
  const grade      = cleanText(searchParams.get('grade'), '', 6);
  const pointsQ    = searchParams.get('points');
  const color      = parseHexColor(searchParams.get('color'));
  const logo       = parseEnum(searchParams.get('logo'), ['github', 'saber', 'galaxy'] as const, 'saber');
  const granular   = searchParams.get('granular') === '1';
  const showPoints = searchParams.get('showPoints') === '1';
  const showNext   = searchParams.get('showNext') === '1';
  const xpParam    = parseEnum(searchParams.get('xp'), ['dots', 'bar', 'none'] as const, 'dots');
  const theme      = parseEnum(searchParams.get('theme'), ['jedi', 'sith'] as const, 'jedi');

  let rightPersona = persona;
  let rightGrade   = grade;
  let rightColor   = color ?? '';
  let points: number | null = null;

  if (pointsQ !== null && pointsQ.trim() !== '') {
    const p = Number(pointsQ);
    points = clampPoints(Number.isNaN(p) ? 0 : p);
    const t = pickTierByPoints(points);
    rightPersona = t.name;
    rightGrade   = t.grade;
    rightColor   = color ?? t.color; // an explicit valid ?color= still wins
  }

  rightPersona ||= 'Master Yoda';
  rightGrade   ||= 'S++';
  rightColor   ||= '#22c55e';

  const parts: string[] = [];
  let progressRatio: number | undefined;

  if (points !== null) {
    // Band, "next tier" and XP progress all derive from a real point value,
    // independently of each other (previously showNext and the XP indicator
    // silently did nothing unless granular=1).
    const { bandRoman, nextTier, pointsToNext, pctToNext } = tierWithBand(points);
    progressRatio = (pctToNext ?? 0) / 100;
    parts.push(granular ? `${rightPersona} (${rightGrade}) • ${bandRoman}` : `${rightPersona} (${rightGrade})`);
    if (showPoints) parts.push(`${points.toFixed(1)} pts`);
    if (showNext && nextTier && typeof pointsToNext === 'number') {
      parts.push(`+${pointsToNext.toFixed(1)} to ${nextTier.name}`);
    }
  } else {
    parts.push(`${rightPersona} (${rightGrade})`);
  }
  const rightText = parts.join(' • ');

  const isMaxed = rightGrade === 'S++';

  const { svg } = buildBadgeSVG({
    label,
    rightText,
    rightColor,
    icon: logo,
    progressRatio: xpParam === 'none' ? undefined : (isMaxed ? 1 : progressRatio),
    progressVariant: xpParam === 'bar' ? 'bar' : 'dots',
    theme,
    decorateMaxed: isMaxed
  });

  return svgResponse(svg, cacheHeaders(3600, false));
}
