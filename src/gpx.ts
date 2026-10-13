import { latestHistory, type Mark } from './dsdata.ts';

/** Pin category. OsmAnd groups waypoints by GPX <type>, so each category becomes a toggleable group. */
export interface Category {
  id: 'good' | 'scaled' | 'notFound' | 'unknown';
  label: string;
  color: string;
}

export const CATEGORIES: Record<Category['id'], Category> = {
  good: { id: 'good', label: 'Found, usable position', color: '#2e9e44' },
  scaled: { id: 'scaled', label: 'Found, scaled position', color: '#e0a400' },
  notFound: { id: 'notFound', label: 'Not found last time', color: '#d1342f' },
  unknown: { id: 'unknown', label: 'No recovery on record', color: '#7a7a7a' },
};

const NOT_FOUND = /NOT FOUND/i;

/**
 * Assign a mark to a category from its latest report and position source.
 *
 * Not found wins over position quality: a precise coordinate for a mark
 * nobody could find last visit is still a long shot.
 */
export function categorize(mark: Mark): Category {
  const last = latestHistory(mark);
  if (!last || mark.history.length < 2) return CATEGORIES.unknown;
  if (NOT_FOUND.test(last.condition)) return CATEGORIES.notFound;
  if (mark.posSource === 'SCALED') return CATEGORIES.scaled;
  return CATEGORIES.good;
}

/** Plain-language accuracy of each horizontal position source, from the DSDATA format reference. */
export function positionAccuracy(source: string): string {
  switch (source) {
    case 'ADJUSTED':
    case 'NO CHECK':
      return 'surveyed, centimeters';
    case 'HD_HELD1':
      return 'handheld GPS, about 3 m';
    case 'HD_HELD2':
      return 'handheld GPS, about 10 m';
    case 'SCALED':
      return 'scaled from a map, off by up to about 180 m';
    default:
      return source || 'unknown';
  }
}

/** Format a history date (YYYY or YYYYMMDD) for reading. */
export function formatDate(d: string): string {
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d;
}

/** Strip the "NN = " code prefix NGS puts on marker, setting, and stability values. */
function plain(value?: string): string | undefined {
  return value?.replace(/^\w{1,3} = /, '');
}

export function datasheetUrl(pid: string): string {
  return `https://geodesy.noaa.gov/cgi-bin/ds_mark.prl?PidBox=${pid}`;
}

/** One-line summary, used for the GPX comment and map popups. */
export function summary(mark: Mark): string {
  const last = latestHistory(mark);
  const parts = [plain(mark.marker) ?? 'Mark'];
  if (last) parts.push(`${last.condition} ${formatDate(last.date)}`);
  parts.push(`position ${mark.posSource}`);
  return parts.join(' · ');
}

/**
 * Build the full field text for a mark: what to look for, then how to find it.
 *
 * Ordered for use standing at the site. Identification first, then the
 * original description, then recoveries newest first since recent notes
 * describe the site as it is now.
 */
export function fieldText(mark: Mark): string {
  const out: string[] = [];
  const last = latestHistory(mark);
  const monumented = mark.history.find((h) => /MONUMENTED/i.test(h.condition));

  out.push(`${mark.designation} (${mark.pid})`);
  out.push(`Position: ${mark.posSource}, ${positionAccuracy(mark.posSource)}`);
  if (mark.orthoHeightFt !== undefined) {
    out.push(`Elevation: ${mark.orthoHeightFt} ft (${mark.orthoHeightM} m), ${mark.vertSource ?? ''}`.trim());
  }
  if (last) out.push(`Last report: ${last.condition}, ${formatDate(last.date)}, ${last.reportBy}`);
  if (monumented) out.push(`Monumented: ${formatDate(monumented.date)}, ${monumented.reportBy}`);
  if (mark.marker) out.push(`Marker: ${plain(mark.marker)}`);
  if (mark.stamping) out.push(`Stamping: ${mark.stamping}`);
  if (mark.setting) out.push(`Setting: ${plain(mark.setting)}`);
  if (mark.projection) out.push(`Projection: ${mark.projection}`);
  if (mark.magnetic) out.push(`Magnetic: ${plain(mark.magnetic)}`);

  if (mark.description) {
    out.push('', `DESCRIPTION${mark.describedBy ? ` (${mark.describedBy})` : ''}`, mark.description);
  }
  if (mark.referenceObjects.length) {
    out.push('', 'REFERENCE OBJECTS', ...mark.referenceObjects);
  }
  for (const r of [...mark.recoveries].reverse()) {
    out.push('', `RECOVERY ${r.year}${r.by ? ` (${r.by})` : ''}`, r.text);
  }
  out.push('', `Datasheet: ${datasheetUrl(mark.pid)}`);
  return out.join('\n');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters; old datasheets occasionally carry them.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/**
 * Build a GPX 1.1 file of waypoints that OsmAnd imports with colors and groups.
 *
 * Name carries designation and PID so pins are identifiable at a glance.
 * <cmt> holds the one-line summary and <desc> the full field text, since
 * some apps show only one of the two.
 */
export function buildGpx(marks: Mark[], title: string): string {
  const wpts = marks.map((m) => {
    const cat = categorize(m);
    return [
      `  <wpt lat="${m.lat.toFixed(7)}" lon="${m.lon.toFixed(7)}">`,
      m.orthoHeightM !== undefined ? `    <ele>${m.orthoHeightM}</ele>` : '',
      `    <name>${esc(`${m.designation} ${m.pid}`)}</name>`,
      `    <cmt>${esc(summary(m))}</cmt>`,
      `    <desc>${esc(fieldText(m))}</desc>`,
      `    <link href="${esc(datasheetUrl(m.pid))}"><text>NGS datasheet</text></link>`,
      `    <type>${esc(cat.label)}</type>`,
      '    <extensions>',
      `      <osmand:color>${cat.color}</osmand:color>`,
      '      <osmand:background>circle</osmand:background>',
      '    </extensions>',
      '  </wpt>',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="benchmark-gpx" xmlns="http://www.topografix.com/GPX/1/1" xmlns:osmand="https://osmand.net">',
    `  <metadata><name>${esc(title)}</name></metadata>`,
    ...wpts,
    '</gpx>',
    '',
  ].join('\n');
}
