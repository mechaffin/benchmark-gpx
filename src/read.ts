import { Unzip, UnzipInflate, unzipSync } from 'fflate';

export interface ReadProgress {
  fileName: string;
  bytesRead: number;
  totalBytes: number;
}

/**
 * Stream the text content of an NGS download into `onText`.
 *
 * Accepts plain datasheet files (.txt, .dat, .html) and zip archives,
 * including archives that wrap per-county zips. Zips stream entry by entry
 * so a statewide archive never sits fully decompressed in memory.
 */
export async function readNgsFile(
  file: File,
  onText: (chunk: string) => void,
  onEntryEnd: () => void,
  onProgress: (p: ReadProgress) => void,
): Promise<void> {
  const isZip = /\.zip$/i.test(file.name) || (await sniffZip(file));
  const reader = file.stream().getReader();
  let bytesRead = 0;

  if (!isZip) {
    const decoder = new TextDecoder('latin1');
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      onText(decoder.decode(value, { stream: true }));
      onProgress({ fileName: file.name, bytesRead, totalBytes: file.size });
    }
    onText(decoder.decode());
    onEntryEnd();
    return;
  }

  const nested: Uint8Array[][] = [];
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (entry) => {
    if (entry.name.endsWith('/')) return;
    if (/\.zip$/i.test(entry.name)) {
      const parts: Uint8Array[] = [];
      nested.push(parts);
      entry.ondata = (err, data) => {
        if (err) throw err;
        parts.push(data);
      };
    } else {
      const decoder = new TextDecoder('latin1');
      entry.ondata = (err, data, final) => {
        if (err) throw err;
        onText(decoder.decode(data, { stream: true }));
        if (final) {
          onText(decoder.decode());
          onEntryEnd();
        }
      };
    }
    entry.start();
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytesRead += value.length;
    unzip.push(value, false);
    onProgress({ fileName: file.name, bytesRead, totalBytes: file.size });
  }
  unzip.push(new Uint8Array(0), true);

  for (const parts of nested) {
    const inner = unzipSync(concat(parts));
    for (const [name, bytes] of Object.entries(inner)) {
      if (name.endsWith('/')) continue;
      onText(new TextDecoder('latin1').decode(bytes));
      onEntryEnd();
    }
  }
}

async function sniffZip(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
