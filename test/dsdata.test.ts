import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSplitter, parseDatasheet, isDestroyed, inBounds, type Mark, type Bounds } from '../src/dsdata.ts';
import { buildGpx, categorize, fieldText } from '../src/gpx.ts';

const sample = readFileSync(new URL('./fixtures/sample.txt', import.meta.url), 'utf8');

// Newfound Gap Road corridor, roughly Gatlinburg to Oconaluftee.
const smokies: Bounds = { minLat: 35.5, maxLat: 35.72, minLon: -83.53, maxLon: -83.3 };

function parseAll(text: string, keep?: (lat: number, lon: number) => boolean, chunk = text.length): Mark[] {
  const marks: Mark[] = [];
  const s = createSplitter({
    keep,
    onSheet: (lines) => {
      const m = parseDatasheet(lines);
      if (m) marks.push(m);
    },
  });
  for (let i = 0; i < text.length; i += chunk) s.push(text.slice(i, i + chunk));
  s.end();
  return marks;
}

test('splits every datasheet', () => {
  assert.deepEqual(parseAll(sample).map((m) => m.pid), ['ZZ0001', 'ZZ0002', 'ZZ0003', 'ZZ0004', 'ZZ0005']);
});

test('chunk boundaries and CRLF do not change the result', () => {
  const whole = parseAll(sample);
  assert.deepEqual(parseAll(sample.replace(/\n/g, '\r\n'), undefined, 37), whole);
});

test('reads an adjusted position and identity fields', () => {
  const m = parseAll(sample)[0];
  assert.equal(m.designation, 'TEST GAP');
  assert.equal(m.stateCounty, 'TN/SEVIER');
  assert.equal(m.posSource, 'ADJUSTED');
  assert.equal(m.datum, 'NAD 83(2011)');
  assert.ok(Math.abs(m.lat - (35 + 36 / 60 + 40.12345 / 3600)) < 1e-9);
  assert.ok(Math.abs(m.lon + (83 + 25 / 60 + 30.54321 / 3600)) < 1e-9);
  assert.equal(m.orthoHeightFt, 5045.56);
  assert.equal(m.vertSource, 'ADJUSTED');
});

test('reads scaled positions with whole seconds', () => {
  const m = parseAll(sample)[1];
  assert.equal(m.posSource, 'SCALED');
  assert.ok(Math.abs(m.lat - (35 + 34 / 60 + 12 / 3600)) < 1e-9);
});

test('reads VERTCON3 heights given with an accuracy instead of units', () => {
  const m = parseAll(sample)[4];
  assert.equal(m.orthoHeightM, 1145.21);
  assert.equal(m.vertSource, 'VERTCON3');
});

test('reads monumentation, joining continuation lines', () => {
  const m = parseAll(sample)[0];
  assert.equal(m.marker, 'DS = TRIANGULATION STATION DISK');
  assert.equal(m.stamping, 'TEST GAP 1934');
  assert.equal(m.stability, 'A = MOST RELIABLE AND EXPECTED TO HOLD POSITION/ELEVATION WELL');
});

test('reads history with multi-word conditions', () => {
  const m = parseAll(sample)[1];
  assert.deepEqual(m.history, [
    { date: '1931', condition: 'MONUMENTED', reportBy: 'CGS' },
    { date: '20110405', condition: 'MARK NOT FOUND', reportBy: 'GEOCAC' },
  ]);
});

test('separates the description from recoveries', () => {
  const m = parseAll(sample)[0];
  assert.equal(m.describedBy, 'COAST AND GEODETIC SURVEY 1934');
  assert.match(m.description, /^AT THE STATE LINE PARKING AREA\. STATION IS 45 FEET/);
  assert.deepEqual(m.recoveries.map((r) => r.year), ['1960', '2019']);
  assert.deepEqual(m.recoveries[1], {
    year: '2019',
    by: 'GEOCACHING 2019 (XYZ)',
    text: 'FOUND IN GOOD CONDITION. BOTH RMS ALSO FOUND. TAPED DISTANCES MATCH.',
  });
  assert.equal(m.referenceObjects.length, 4);
});

test('detects destroyed marks', () => {
  assert.deepEqual(parseAll(sample).filter(isDestroyed).map((m) => m.pid), ['ZZ0003']);
});

test('area filter drops outside sheets at the position line', () => {
  const kept = parseAll(sample, (lat, lon) => inBounds(lat, lon, smokies), 64);
  assert.deepEqual(kept.map((m) => m.pid), ['ZZ0001', 'ZZ0002', 'ZZ0003', 'ZZ0005']);
});

test('decodes datasheets saved as HTML', () => {
  const html = '<html><body><pre>' + sample.replace(/&/g, '&amp;') + '</pre></body></html>';
  const m = parseAll(html).find((x) => x.pid === 'ZZ0005');
  assert.equal(m?.designation, 'K 12 & RESET');
});

test('categorizes for pin colors', () => {
  const ids = parseAll(sample).map((m) => categorize(m).id);
  assert.deepEqual(ids, ['good', 'notFound', 'good', 'unknown', 'good']);
});

test('field text leads with identification and puts newest recovery first', () => {
  const t = fieldText(parseAll(sample)[0]);
  assert.match(t, /^TEST GAP \(ZZ0001\)\nPosition: ADJUSTED, surveyed/);
  assert.ok(t.indexOf('RECOVERY 2019') < t.indexOf('RECOVERY 1960'));
});

test('GPX escapes text and carries OsmAnd extensions', () => {
  const gpx = buildGpx(parseAll(sample).filter((m) => !isDestroyed(m)), 'Test & area');
  assert.match(gpx, /<name>Test &amp; area<\/name>/);
  assert.match(gpx, /<name>K 12 &amp; RESET ZZ0005<\/name>/);
  assert.match(gpx, /<osmand:color>#d1342f<\/osmand:color>/);
  assert.equal((gpx.match(/<wpt /g) ?? []).length, 4);
});
