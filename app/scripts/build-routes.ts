/**
 * Builds src/data/generated/routes.geo.json from the itinerary.
 *
 *  rail      → shortest path along the OSM railway relations listed in `osmLines`
 *              (downloaded once with ../scripts/fetch-rail.sh into scripts/.cache/rail)
 *  local     → driving route from the public OSRM demo server (road alignment, approx.)
 *  schematic → no geometry; drawn as an arc at render time
 *
 * Run: npm run build:routes
 * Map data © OpenStreetMap contributors (ODbL).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { SEGMENTS, STOPS, WAYPOINTS } from "../src/data/itinerary";

const RAIL_DIR = "../scripts/.cache/rail";
const R = 6371.0088;
const rad = Math.PI / 180;
type P = [number, number];

const hav = (a: P, b: P) => {
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const place = (id: string): P => {
  const s = STOPS.find((x) => x.id === id) ?? WAYPOINTS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown place ${id}`);
  return [s.longitude, s.latitude];
};

// ---------- OSM XML (relation/full) parsing
type Rel = { nodes: Map<string, P>; ways: string[][] };
const relCache = new Map<number, Rel>();
function loadRel(id: number): Rel {
  if (relCache.has(id)) return relCache.get(id)!;
  const path = `${RAIL_DIR}/${id}.osm`;
  if (!existsSync(path)) throw new Error(`missing ${path}; run scripts/fetch-rail.sh`);
  const xml = readFileSync(path, "utf8");
  const nodes = new Map<string, P>();
  for (const m of xml.matchAll(/<node\b([^>]*)\/?>/g)) {
    const a = m[1];
    const id = /\bid="(\d+)"/.exec(a)?.[1], lat = /\blat="([-\d.]+)"/.exec(a)?.[1], lon = /\blon="([-\d.]+)"/.exec(a)?.[1];
    if (id && lat && lon) nodes.set(id, [+lon, +lat]);
  }
  const ways: string[][] = [];
  for (const m of xml.matchAll(/<way\b[^>]*>([\s\S]*?)<\/way>/g)) {
    const body = m[1];
    const railway = /<tag k="railway" v="([^"]+)"/.exec(body)?.[1];
    if (railway !== "rail") continue;
    const refs = [...body.matchAll(/<nd ref="(\d+)"/g)].map((x) => x[1]);
    if (refs.length > 1) ways.push(refs);
  }
  const rel = { nodes, ways };
  relCache.set(id, rel);
  return rel;
}

// ---------- graph + Dijkstra
function railPath(lineIds: number[], from: P, to: P, maxBridgeKm = 3): P[] {
  const coord = new Map<string, P>();
  const adj = new Map<string, { to: string; w: number }[]>();
  const link = (a: string, b: string, penalty = 1) => {
    const w = hav(coord.get(a)!, coord.get(b)!) * penalty;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, w });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ to: a, w });
  };
  for (const id of lineIds) {
    const rel = loadRel(id);
    for (const w of rel.ways) {
      for (const r of w) if (rel.nodes.has(r)) coord.set(r, rel.nodes.get(r)!);
      for (let i = 1; i < w.length; i++) if (coord.has(w[i - 1]) && coord.has(w[i])) link(w[i - 1], w[i]);
    }
  }
  // bridge gaps (<3 km) at dead ends: OSM relations often have small breaks between member ways.
  // Bridges cost 3× so real track always wins where it exists.
  const ends = [...adj.entries()].filter(([, e]) => e.length === 1).map(([k]) => k);
  const cs = Math.max(0.03, maxBridgeKm / 100);
  const cell = (p: P) => `${Math.floor(p[0] / cs)},${Math.floor(p[1] / cs)}`;
  const grid = new Map<string, string[]>();
  for (const k of coord.keys()) (grid.get(cell(coord.get(k)!)) ?? grid.set(cell(coord.get(k)!), []).get(cell(coord.get(k)!))!).push(k);
  for (const e of ends) {
    const p = coord.get(e)!;
    const [cx, cy] = cell(p).split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const k of grid.get(`${cx + dx},${cy + dy}`) ?? [])
        if (k !== e && hav(p, coord.get(k)!) < maxBridgeKm && !adj.get(e)!.some((x) => x.to === k)) link(e, k, 3);
  }

  const nearest = (p: P) => {
    let best = "", bd = Infinity;
    for (const [k, c] of coord) if (adj.has(k)) { const d = hav(p, c); if (d < bd) { bd = d; best = k; } }
    return { id: best, d: bd };
  };
  const s = nearest(from), t = nearest(to);
  if (s.d > 3 || t.d > 3) console.warn(`  ! station snap distance ${s.d.toFixed(2)} / ${t.d.toFixed(2)} km`);

  // Dijkstra with a binary heap
  const dist = new Map<string, number>([[s.id, 0]]);
  const prev = new Map<string, string>();
  const heap: [number, string][] = [[0, s.id]];
  const push = (x: [number, string]) => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === t.id) break;
    if (d > (dist.get(u) ?? Infinity)) continue;
    for (const e of adj.get(u) ?? []) {
      const nd = d + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); push([nd, e.to]); }
    }
  }
  if (!dist.has(t.id)) throw new Error("no rail path found — graph disconnected");
  const path: P[] = [];
  for (let u: string | undefined = t.id; u; u = prev.get(u)) path.push(coord.get(u)!);
  return path.reverse();
}

// ---------- local legs via OSRM
async function roadPath(from: P, to: P): Promise<P[]> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.join(",")};${to.join(",")}?overview=full&geometries=geojson`;
  const res = await fetch(url, { headers: { "User-Agent": "ChinaCycleAdventureMap/1.0 (personal trip map)" } });
  const j: any = await res.json();
  if (j.code !== "Ok") throw new Error(`OSRM: ${j.code}`);
  await new Promise((r) => setTimeout(r, 1100));
  return j.routes[0].geometry.coordinates;
}

// ---------- Douglas–Peucker in local metric space
function simplify(pts: P[], tolKm: number): P[] {
  if (pts.length < 3) return pts;
  const lat0 = pts[0][1] * rad;
  const xy = pts.map(([x, y]) => [x * rad * R * Math.cos(lat0), y * rad * R]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * xy[i][0] - dx * xy[i][1] + bx * ay - by * ax) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tolKm && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
}

const lengthKm = (pts: P[]) => pts.reduce((s, p, i) => (i ? s + hav(pts[i - 1], p) : 0), 0);

const features: Feature<LineString>[] = [];
const failed: string[] = [];
for (const seg of SEGMENTS) {
  if (seg.mode === "schematic" && !seg.osmRoute) { console.log(`${seg.id}: schematic (no geometry)`); continue; }
  // schematic legs with an osmRoute are still traced, for their measured length; the map draws an arc
  const a = place(seg.osmRoute ? "chengdu-west" : seg.from), b = place(seg.osmRoute ? seg.osmRoute[seg.osmRoute.length - 1].via : seg.to);
  let pts: P[]; let source: string;
  if (seg.mode === "rail" || seg.osmRoute) {
    try {
      if (seg.osmRoute) {
        pts = [];
        let from = a;
        for (const hop of seg.osmRoute) {
          const to = place(hop.via);
          let part: P[] | null = null;
          for (const bridge of [3, 8, 15]) {
            try { part = railPath(hop.lines, from, to, bridge); break; }
            catch { console.warn(`   ! hop → ${hop.via}: OSM gap wider than ${bridge} km, retrying`); }
          }
          if (!part) throw new Error(`no path to ${hop.via}`);
          console.log(`   hop → ${hop.via}: ${lengthKm(part).toFixed(0)} km`);
          pts.push(...(pts.length ? part.slice(1) : part));
          from = to;
        }
      } else pts = railPath(seg.osmLines ?? [], a, b);
    }
    catch (e) { console.error(`  ✗ ${seg.id}: ${(e as Error).message}`); failed.push(seg.id); continue; }
    source = "OpenStreetMap railway relations " + [...new Set(seg.osmRoute ? seg.osmRoute.flatMap((h) => h.lines) : seg.osmLines ?? [])].join(", ");
  } else {
    pts = await roadPath(a, b);
    source = "OSRM road route over OpenStreetMap";
  }
  const km = lengthKm(pts);
  const simple = simplify(pts, seg.mode === "rail" ? 0.08 : 0.04);
  console.log(`${seg.id}: ${seg.mode} ${km.toFixed(0)} km (straight ${hav(a, b).toFixed(0)} km), ${pts.length}→${simple.length} pts`);
  features.push({
    type: "Feature",
    properties: { id: seg.id, mode: seg.mode, lengthKm: Math.round(km), source },
    geometry: { type: "LineString", coordinates: simple },
  });
}
const fc: FeatureCollection = { type: "FeatureCollection", features };
writeFileSync("src/data/generated/routes.geo.json", JSON.stringify(fc));
if (failed.length) console.error("FAILED:", failed.join(", "));
console.log("wrote routes.geo.json", JSON.stringify(fc).length, "bytes");
