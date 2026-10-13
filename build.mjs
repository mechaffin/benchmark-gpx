// Bundle the app and inline it into one HTML file, so it runs from any static host or straight from disk.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outdir: 'out',
  write: false,
  loader: { '.png': 'dataurl', '.svg': 'dataurl' },
});
const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
const html = readFileSync('src/index.html', 'utf8').replace(
  '<!--APP-->',
  () => `<style>${css}</style>\n<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`,
);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB`);
