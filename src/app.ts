import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createSplitter, parseDatasheet, isDestroyed, inBounds, type Bounds, type Mark } from './dsdata.ts';
import { buildGpx, categorize, summary, datasheetUrl, CATEGORIES } from './gpx.ts';
import { readNgsFile } from './read.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('files');
const fileList = $<HTMLElement>('file-list');
const areaBtn = $<HTMLButtonElement>('set-area');
const areaText = $<HTMLElement>('area-text');
const findBtn = $<HTMLButtonElement>('find');
const progress = $<HTMLProgressElement>('progress');
const status = $<HTMLElement>('status');
const results = $<HTMLElement>('results');
const downloadBtn = $<HTMLButtonElement>('download');

// Newfound Gap, a reasonable first view and the trip this was built for.
const map = L.map('map', { zoomControl: true }).setView([35.611, -83.425], 11);

const usgsTopo = L.tileLayer(
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 16, attribution: 'USGS The National Map' },
);
const usgsImagery = L.tileLayer(
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 16, attribution: 'USGS The National Map' },
);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
});
usgsTopo.addTo(map);
L.control.layers({ 'USGS topo': usgsTopo, 'USGS imagery': usgsImagery, OpenStreetMap: osm }).addTo(map);

let area: Bounds | null = null;
let areaRect: L.Rectangle | null = null;
let marks: Mark[] = [];
const pins = L.layerGroup().addTo(map);

fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  fileList.textContent = files.length
    ? files.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ')
    : 'No files chosen';
  updateButtons();
});

areaBtn.addEventListener('click', () => {
  const b = map.getBounds();
  area = { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() };
  areaRect?.remove();
  areaRect = L.rectangle(b, { color: '#1f5fbf', weight: 2, fill: false, dashArray: '6 4' }).addTo(map);
  const widthKm = b.getSouthWest().distanceTo(b.getSouthEast()) / 1000;
  const heightKm = b.getSouthWest().distanceTo(b.getNorthWest()) / 1000;
  areaText.textContent = `${widthKm.toFixed(1)} km by ${heightKm.toFixed(1)} km`;
  updateButtons();
});

findBtn.addEventListener('click', () => void find());

downloadBtn.addEventListener('click', () => {
  if (!marks.length) return;
  const date = new Date().toISOString().slice(0, 10);
  const gpx = buildGpx(marks, `NGS marks ${date}`);
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ngs-marks-${date}.gpx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function updateButtons() {
  findBtn.disabled = !(fileInput.files?.length && area);
}

async function find() {
  if (!area || !fileInput.files?.length) return;
  const bounds = area;
  const files = [...fileInput.files];
  const byPid = new Map<string, Mark>();
  let destroyed = 0;
  let scanned = 0;

  findBtn.disabled = true;
  downloadBtn.disabled = true;
  progress.hidden = false;
  results.replaceChildren();
  pins.clearLayers();

  const splitter = createSplitter({
    keep: (lat, lon) => {
      scanned++;
      return inBounds(lat, lon, bounds);
    },
    onSheet: (lines) => {
      const m = parseDatasheet(lines);
      if (!m) return;
      if (isDestroyed(m)) destroyed++;
      else byPid.set(m.pid, m);
    },
  });

  try {
    for (const [i, file] of files.entries()) {
      await readNgsFile(
        file,
        (t) => splitter.push(t),
        () => splitter.end(),
        (p) => {
          progress.value = (i + p.bytesRead / p.totalBytes) / files.length;
          status.textContent = `Reading ${p.fileName}: ${scanned.toLocaleString()} marks checked, ${byPid.size} in area`;
        },
      );
    }
  } catch (err) {
    status.textContent = `That file couldn't be read: ${(err as Error).message}`;
    progress.hidden = true;
    updateButtons();
    return;
  }

  marks = [...byPid.values()].sort((a, b) => b.lat - a.lat);
  progress.hidden = true;
  updateButtons();

  if (!scanned) {
    status.textContent = 'No datasheets found in those files. They should be NGS datasheet text or a zip of it.';
    return;
  }
  status.textContent =
    `${plural(marks.length, 'mark')} in the area out of ${scanned.toLocaleString()} checked.` +
    (destroyed ? ` ${plural(destroyed, 'destroyed mark')} left out.` : '');
  showResults();
  downloadBtn.disabled = !marks.length;
}

function showResults() {
  const counts = new Map<string, number>();
  for (const m of marks) {
    const cat = categorize(m);
    counts.set(cat.id, (counts.get(cat.id) ?? 0) + 1);

    const marker = L.circleMarker([m.lat, m.lon], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: cat.color,
      fillOpacity: 1,
    });
    marker.bindPopup(() => popup(m));
    pins.addLayer(marker);
  }

  for (const cat of Object.values(CATEGORIES)) {
    const n = counts.get(cat.id);
    if (!n) continue;
    const row = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = cat.color;
    row.append(dot, `${cat.label}: ${n}`);
    results.append(row);
  }
}

function popup(m: Mark): HTMLElement {
  const el = document.createElement('div');
  el.className = 'popup';
  const h = document.createElement('strong');
  h.textContent = `${m.designation} (${m.pid})`;
  const s = document.createElement('div');
  s.className = 'popup-summary';
  s.textContent = summary(m);
  const d = document.createElement('p');
  d.textContent = m.description.length > 320 ? m.description.slice(0, 320) + '...' : m.description;
  const a = document.createElement('a');
  a.href = datasheetUrl(m.pid);
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Open datasheet';
  el.append(h, s, d, a);
  return el;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
