/**
 * Parser for NGS datasheets in DSDATA format.
 *
 * Format reference: https://www.ngs.noaa.gov/DATASHEET/dsdata.pdf
 * Each datasheet line is: column 1 blank, columns 2-7 the PID, column 8 a
 * record tag, then content. A new datasheet starts on a line whose first
 * column is "1".
 */

export type PositionSource = 'ADJUSTED' | 'NO CHECK' | 'HD_HELD1' | 'HD_HELD2' | 'SCALED' | string;

export interface HistoryEntry {
  date: string;
  condition: string;
  reportBy: string;
}

export interface Recovery {
  /** Year from the "STATION RECOVERY (YYYY)" header. */
  year: string;
  /** Who reported it, from the "RECOVERY NOTE BY" line. */
  by: string;
  text: string;
}

export interface Mark {
  pid: string;
  designation: string;
  stateCounty: string;
  quad: string;
  lat: number;
  lon: number;
  datum: string;
  posSource: PositionSource;
  orthoHeightM?: number;
  orthoHeightFt?: number;
  vertDatum?: string;
  vertSource?: string;
  marker?: string;
  setting?: string;
  stamping?: string;
  logo?: string;
  projection?: string;
  magnetic?: string;
  stability?: string;
  history: HistoryEntry[];
  /** Original station description, without its "DESCRIBED BY" line, unwrapped to one paragraph. */
  description: string;
  describedBy: string;
  recoveries: Recovery[];
  /** Reference object table ("box score") lines, when the mark has one. */
  referenceObjects: string[];
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

const FIRST_LINE = /^1\s+NATIONAL GEODETIC SURVEY/i;
const POSITION =
  /POSITION-\s*(\d+)\s+(\d+)\s+([\d.]+)\s*\(([NS])\)\s+(\d+)\s+(\d+)\s+([\d.]+)\s*\(([EW])\)\s*(.*)$/;

/** Convert degrees, minutes, and seconds to signed decimal degrees. */
export function dmsToDecimal(d: string, m: string, s: string, hemi: string): number {
  const value = Number(d) + Number(m) / 60 + parseFloat(s) / 3600;
  return hemi === 'S' || hemi === 'W' ? -value : value;
}

/**
 * Read the current horizontal position from a datasheet's lines.
 *
 * Only the "*" tagged line counts. Superseded positions use the same
 * POSITION wording without the tag.
 */
export function readPosition(lines: string[]): { lat: number; lon: number; datum: string; source: string } | null {
  for (const line of lines) {
    if (line[7] !== '*' || !line.includes('POSITION-')) continue;
    const m = POSITION.exec(line);
    if (!m) return null;
    const datum = line.slice(8, line.indexOf('POSITION-')).trim();
    return {
      lat: dmsToDecimal(m[1], m[2], m[3], m[4]),
      lon: dmsToDecimal(m[5], m[6], m[7], m[8]),
      datum,
      source: m[9].trim(),
    };
  }
  return null;
}

export function inBounds(lat: number, lon: number, b: Bounds): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

function field(content: string, label: string): string | undefined {
  const m = new RegExp(`^\\s*${label}\\s*-\\s*(.*)$`).exec(content);
  return m ? m[1].trim() : undefined;
}

/** Parse one datasheet's lines into a Mark. Returns null when it has no published position. */
export function parseDatasheet(lines: string[]): Mark | null {
  const pos = readPosition(lines);
  if (!pos) return null;

  const mark: Mark = {
    pid: '',
    designation: '',
    stateCounty: '',
    quad: '',
    lat: pos.lat,
    lon: pos.lon,
    datum: pos.datum,
    posSource: pos.source,
    history: [],
    description: '',
    describedBy: '',
    recoveries: [],
    referenceObjects: [],
  };

  // Which free-text block the apostrophe-tagged lines currently belong to.
  let block: 'none' | 'description' | 'recovery' = 'none';
  const descLines: string[] = [];
  let current: Recovery | null = null;
  let lastMonumentField: keyof Mark | null = null;

  for (const raw of lines) {
    if (raw.length < 8 || raw[0] !== ' ') continue;
    const pid = raw.slice(1, 7);
    const tag = raw[7];
    const content = raw.slice(8);
    if (!mark.pid && /^[A-Z]{2}\d{4}$/.test(pid)) mark.pid = pid;

    if (tag === ' ') {
      const header = content.trim();
      if (header === 'STATION DESCRIPTION') {
        block = 'description';
        continue;
      }
      const rec = /^STATION RECOVERY \((\w+)\)/.exec(header);
      if (rec) {
        block = 'recovery';
        current = { year: rec[1], by: '', text: '' };
        mark.recoveries.push(current);
        continue;
      }
      mark.designation ||= field(content, 'DESIGNATION') ?? '';
      mark.stateCounty ||= field(content, 'STATE/COUNTY') ?? '';
      mark.quad ||= field(content, 'USGS QUAD') ?? '';
      const hist = /^\s*HISTORY\s*-\s*(\S+)\s+(.+?)\s+(\S+)\s*$/.exec(content);
      if (hist && hist[1] !== 'Date') {
        mark.history.push({ date: hist[1], condition: hist[2].trim(), reportBy: hist[3] });
      }
      continue;
    }

    if (tag === '*' && content.includes('ORTHO HEIGHT')) {
      const h = /^\s*(.+?)\s+ORTHO HEIGHT\s*-\s*([-\d.]+)\s*\((?:meters|\+\/-\d+cm)\)\s+([-\d.]+)\s*\(feet\)\s*(.*)$/.exec(content);
      if (h) {
        mark.vertDatum = h[1].trim();
        mark.orthoHeightM = parseFloat(h[2]);
        mark.orthoHeightFt = parseFloat(h[3]);
        mark.vertSource = h[4].trim();
      }
      continue;
    }

    if (tag === '_' || tag === '+') {
      const m = /^([A-Z /-]+?)\s*:\s*(.*)$/.exec(content);
      if (!m) continue;
      const key = monumentKey(m[1].trim());
      const value = m[2].trim();
      if (tag === '+' && key && key === lastMonumentField) {
        (mark as unknown as Record<string, string>)[key] += ' ' + value;
      } else if (tag === '_' && key) {
        (mark as unknown as Record<string, string>)[key] = value;
        lastMonumentField = key;
      }
      continue;
    }

    if (tag === '|') {
      const row = content.replace(/\|\s*$/, '').trimEnd();
      if (!/^-+$/.test(row.trim())) mark.referenceObjects.push(row);
      continue;
    }

    if (tag === "'") {
      const text = content.trimEnd();
      if (block === 'description') {
        if (!mark.describedBy && /^DESCRIBED BY /.test(text)) mark.describedBy = text.replace(/^DESCRIBED BY /, '');
        else descLines.push(text);
      } else if (block === 'recovery' && current) {
        const by = /^RECOVERY NOTE BY (.*)$/.exec(text);
        if (by && !current.by && !current.text) current.by = by[1].trim();
        else current.text += (current.text ? ' ' : '') + text.trim();
      }
    }
  }

  // NGS hard-wraps text at 80 columns; rejoin so it reflows on a phone screen.
  mark.description = descLines.map((l) => l.trim()).join(' ');
  return mark;
}

function monumentKey(label: string): keyof Mark | null {
  switch (label) {
    case 'MARKER': return 'marker';
    case 'SETTING': return 'setting';
    case 'STAMPING': return 'stamping';
    case 'MARK LOGO': return 'logo';
    case 'PROJECTION': return 'projection';
    case 'MAGNETIC': return 'magnetic';
    case 'STABILITY': return 'stability';
    default: return null;
  }
}

/** Return the most recent history entry, which is the mark's current reported condition. */
export function latestHistory(mark: Mark): HistoryEntry | undefined {
  return mark.history.at(-1);
}

/** True when the latest report says the mark was destroyed. A later recovery overrides an earlier destroyed report. */
export function isDestroyed(mark: Mark): boolean {
  return /DESTROYED/i.test(latestHistory(mark)?.condition ?? '');
}

export interface SplitterOptions {
  /** Called for each complete datasheet that survives the early position check. */
  onSheet: (lines: string[]) => void;
  /**
   * Decide from the current position alone whether to keep a datasheet.
   * Lines of rejected datasheets are dropped as soon as the position line
   * arrives, which keeps memory flat across statewide files.
   */
  keep?: (lat: number, lon: number) => boolean;
}

/**
 * Split a stream of text chunks into datasheets.
 *
 * Accepts chunks with arbitrary boundaries and either line ending. Also
 * tolerates datasheets saved from the NGS web page as HTML.
 */
export function createSplitter({ onSheet, keep }: SplitterOptions) {
  let carry = '';
  let sheet: string[] | null = null;
  let skipping = false;
  let positionChecked = false;

  const flush = () => {
    if (sheet && !skipping) onSheet(sheet);
    sheet = null;
    skipping = false;
    positionChecked = false;
  };

  const line = (rawLine: string) => {
    const l = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (FIRST_LINE.test(l)) {
      flush();
      sheet = [];
      return;
    }
    if (!sheet || skipping) return;
    if (/^\s*\*{3}\s*retrieval complete/i.test(l)) {
      flush();
      return;
    }
    sheet.push(l);
    if (!positionChecked && keep && l[7] === '*' && l.includes('POSITION-')) {
      positionChecked = true;
      const pos = readPosition([l]);
      if (!pos || !keep(pos.lat, pos.lon)) {
        skipping = true;
        sheet = [];
      }
    }
  };

  return {
    push(chunk: string) {
      const text = carry + chunk;
      const parts = text.split('\n');
      carry = parts.pop() ?? '';
      for (const p of parts) line(decodeHtmlLine(p));
    },
    end() {
      if (carry) line(decodeHtmlLine(carry));
      carry = '';
      flush();
    },
  };
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** Strip tags and common entities so a datasheet saved as a web page parses like plain text. */
function decodeHtmlLine(l: string): string {
  if (!l.includes('<') && !l.includes('&')) return l;
  return l.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e);
}
