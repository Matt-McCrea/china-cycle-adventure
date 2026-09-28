# China Cycle Adventure 2026: route map & journal

Interactive map of a BikeAsia custom cycle tour through Guizhou and Guangxi: Guiyang → Leigong Shan → Dong villages → Longji terraces → Yangshuo, 10–19 October 2026. 508 km and 7,240 m of climbing over 8 riding days, with a journal that riders post to by email (see POSTING.md).

Live: https://matt-mccrea.github.io/china-cycle-adventure/ (deployed by GitHub Actions on every push to main).

```
app/                      Vite + React + TypeScript
  src/data/itinerary.ts   ← THE FILE YOU EDIT: stops, dates, rides, copy, coordinates
  src/data/types.ts       data model (Stop, Waypoint, RouteSegment)
  src/data/generated/     build output: basemap + route geometry (don't edit by hand)
  src/map/                renderer: projection, basemap, routes, label engine
  scripts/                build-basemap.ts, build-routes.ts, ingest-mail.ts
scripts/fetch-rail.sh     downloads OSM railway relations
```

## Run it

```bash
cd app
npm install
npm run dev            # local dev server
npm run build          # static site in dist/
npm run build:single   # one self-contained HTML file in dist-single/
```

Deep links: `#longji` (or any stop id) opens that stop; `#poster` opens poster view; `#world` opens the world view.

The world view (`src/components/WorldView.tsx`, Equal Earth) is separate from the China map, whose Albers projection can't show the whole globe. Its countries come from `npx tsx app/scripts/build-world.ts` → `generated/world.topo.json`.

## Updating the itinerary

Everything lives in `app/src/data/itinerary.ts`. One stop per night; each riding day is a `bike` segment leading into that night's stop.

| Change | What to edit | Rebuild routes? |
|---|---|---|
| Dates, highlights, kicker, copy | `STOPS[]` | no |
| A day's distance or climbing | `SEGMENTS[].rideKm` / `climbM` (planner figures, shown on the cards) | no |
| Trip totals on the poster | `TRIP.totals` | no |
| Move a stop / fix a coordinate | `longitude`, `latitude`, `confidence`, `coordSource` | yes |
| Add or remove a stop | `STOPS[]` (renumber `number`) + the `SEGMENTS[]` that lead into it (`leg` = stop id) | yes |
| Change how a leg is drawn | `SEGMENTS[].mode`: `bike` / `rail` / `local` (transfer) / `schematic` | yes |

Rules the data follows:

- **No invented facts.** Distances, climbing and daily notes come from the BikeAsia brief / route-planner profiles. The drawn lines for rides and transfers are the road router's alignment, which is close but not the exact planned track, so cards show the planner's km, not the line's.
- **Coordinates carry their confidence.** `verified` means taken from an OSM node. `approximate` shows "approx." on the map, a dashed uncertainty ring when zoomed in, and the reason in the card.
- **`leg`** ties a segment to the stop it arrives at. That drives segment highlighting, the "Getting there" section of each card, and the Play Journey order (segments play in array order).

### Regenerating route geometry

```bash
cd app
npm run build:routes
```

- `rail` segments follow the shortest path along the OSM railway relations in `osmLines` (the Guiyang → Kaili bullet train uses the Shanghai–Kunming high-speed line).
- `bike` and `local` segments use the public OSRM demo router (road alignment, approximate).

### Known data gaps (Sept 2026)

- Baiyan Village (白岩村, Leishan) isn't in OSM. It's placed ~8.5 km south-east of Leishan town per the county gazetteer and marked approximate.
- Longji: the brief doesn't name the guesthouse. The stop sits at Ping'an village (the road distance from Sishui matches the planner's 30.7 km) and is marked approximate.
- Day 8 ends "in Lingui" per the brief; the line is drawn to Lingui town, which is longer than the planned 53.5 km, so the ride probably finishes sooner.
- The departure station for the bullet train isn't in the brief; it's drawn from Guiyang North.

## Base map

Built from open data, so there is no tile provider or API key:

- Natural Earth 1:10m (countries, provinces, rivers, lakes) and 1:50m grey shaded relief (public domain)
- Albers equal-area conic, standard parallels 25°N / 47°N, central meridian 105°E (the usual national projection for China; areas stay true)

`npm run build:basemap` regenerates it. It expects the Natural Earth downloads in `scripts/.cache/` (see the header of `app/scripts/build-basemap.ts`). To switch data sources, change that script. The renderer only reads `generated/basemap.topo.json` and `assets/relief.jpg`.

Attribution shown on the map: Natural Earth · © OpenStreetMap contributors (ODbL) · OSRM.
