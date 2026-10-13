# Benchmark GPX

Turns NGS survey mark datasheets into a GPX file for OsmAnd, with the full "to reach" description, recovery history, and reference marks on every pin. Everything runs in the browser. No server, no API key.

## Use it

1. Download NGS datasheets: a state from the [NGS datasheet archive](https://geodesy.noaa.gov/pub/DS_ARCHIVE/DataSheets/), or a saved radius search from the [datasheet page](https://geodesy.noaa.gov/datasheets/). Zips are fine, including zips of county zips. For an area on a state line, load both states.
2. Open the page, add the files (one at a time works), frame your area on the map, and select "Use current map view."
3. Select "Find marks," then "Download GPX."
4. Open the GPX with OsmAnd.

Destroyed marks are left out. Everything else in the area is kept.

The page is one self-contained file, [dist/index.html](dist/index.html) after a build. Host it anywhere static, or open it from disk on a laptop. On a phone, use the hosted copy; Android doesn't open local HTML files reliably.

## Pin colors

Colors also become OsmAnd groups, so you can hide a group.

| Color | Group | Meaning |
|---|---|---|
| Green | Found, usable position | Last report was not "not found," and the position is surveyed or handheld GPS |
| Yellow | Found, scaled position | Last report was not "not found," but the position was scaled from a map and can be off by about 180 m. Navigate by the description. |
| Red | Not found last time | Most recent recovery attempt failed |
| Gray | No recovery on record | Only the original monumentation is on file |

Rules live in `categorize` in [src/gpx.ts](src/gpx.ts).

## What's on each pin

- Name: designation and PID
- Comment: marker type, last condition and date, position source
- Description: position accuracy, elevation, last report, stamping, setting, the original description, reference objects, and recoveries newest first, then the datasheet link

NGS hard-wraps descriptions at 80 columns. The parser rejoins them so they reflow on a phone.

## How it reads large files

Statewide archives stream through the parser one datasheet at a time. Each datasheet's position line is checked against the area as soon as it arrives, and datasheets outside the area are dropped before the rest of their lines are kept. Memory stays flat no matter how big the state is.

## Develop

```sh
npm install
npm test        # parser, GPX, and zip reading
npm run check   # type check
npm run build   # writes dist/index.html
```

Node 22.18 or later runs the TypeScript tests directly, with no build step.

[.github/workflows/pages.yml](.github/workflows/pages.yml) tests, builds, and publishes to GitHub Pages on every push to `main`. Enable Pages in the repo settings with "GitHub Actions" as the source.

## Code

- [src/dsdata.ts](src/dsdata.ts): DSDATA parser and streaming splitter, written against the [NGS format reference](https://www.ngs.noaa.gov/DATASHEET/dsdata.pdf)
- [src/gpx.ts](src/gpx.ts): pin categories, field text, and GPX output with OsmAnd color extensions
- [src/read.ts](src/read.ts): streaming reader for text and zip files
- [src/app.ts](src/app.ts): map page
- [test/fixtures/sample.txt](test/fixtures/sample.txt): synthetic datasheets with fake PIDs (ZZ prefix), built to the format reference

## Known gaps

- Tests use synthetic datasheets. The first real statewide archive is the real test.
- OsmAnd honors the color and background extensions. Other apps ignore them and show plain waypoints.
- The base maps need a connection. Download the region in OsmAnd for offline use in the field.
