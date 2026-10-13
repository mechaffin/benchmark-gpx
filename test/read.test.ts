import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { readNgsFile } from '../src/read.ts';
import { createSplitter, parseDatasheet } from '../src/dsdata.ts';

const sample = readFileSync(new URL('./fixtures/sample.txt', import.meta.url), 'utf8');
const [first, ...rest] = sample.split(/(?=^1\s+National Geodetic Survey)/m);
const half = rest.slice(0, 2).join('');
const otherHalf = rest.slice(2).join('');

async function pidsFrom(file: File): Promise<string[]> {
  const pids: string[] = [];
  const s = createSplitter({ onSheet: (l) => { const m = parseDatasheet(l); if (m) pids.push(m.pid); } });
  await readNgsFile(file, (t) => s.push(t), () => s.end(), () => {});
  return pids.sort();
}

const all = ['ZZ0001', 'ZZ0002', 'ZZ0003', 'ZZ0004', 'ZZ0005'];

test('reads a plain text file', async () => {
  assert.deepEqual(await pidsFrom(new File([sample], 'tn.txt')), all);
});

test('reads a zip with several county files, without datasheets bleeding across entries', async () => {
  const zip = zipSync({ 'TN/tn155.dat': strToU8(first + half), 'TN/tn173.dat': strToU8(otherHalf) });
  assert.deepEqual(await pidsFrom(new File([zip], 'TN.ZIP')), all);
});

test('reads a zip of county zips', async () => {
  const inner1 = zipSync({ 'a.txt': strToU8(first + half) });
  const inner2 = zipSync({ 'b.txt': strToU8(otherHalf) });
  const outer = zipSync({ 'c1.zip': inner1, 'c2.zip': inner2 });
  assert.deepEqual(await pidsFrom(new File([outer], 'state.zip')), all);
});

test('detects a zip without the extension', async () => {
  const zip = zipSync({ 'x.txt': strToU8(sample) });
  assert.deepEqual(await pidsFrom(new File([zip], 'download')), all);
});
