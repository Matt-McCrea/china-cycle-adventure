import routesGeo from "../data/generated/routes.geo.json";
import { SEGMENTS, STOPS, WAYPOINTS } from "../data/itinerary";
import type { RouteSegment, Stop, Waypoint } from "../data/types";
import { baseProjection } from "./projection";

export type Pt = [number, number];

export type SegGeom = {
  seg: RouteSegment;
  /** world-unit polyline */
  pts: Pt[];
  /** cumulative world length at each vertex */
  cum: number[];
  len: number;
  /** measured length along OSM geometry; absent for schematic legs */
  km?: number;
  bbox: [Pt, Pt];
  path: Path2D;
};

const proj = baseProjection();
export const project = (lon: number, lat: number): Pt => proj([lon, lat]) as Pt;

export type Place = (Stop | Waypoint) & { xy: Pt };
export const PLACES = new Map<string, Place>(
  [...STOPS, ...WAYPOINTS].map((p) => [p.id, { ...p, xy: project(p.longitude, p.latitude) }]),
);
export const STOP_XY = new Map(STOPS.map((s) => [s.id, PLACES.get(s.id)!.xy]));

const geomById = new Map<string, { coords: Pt[]; km: number }>(
  (routesGeo as any).features.map((f: any) => [f.properties.id, { coords: f.geometry.coordinates, km: f.properties.lengthKm }]),
);

/** Quadratic arc bowing toward the north (smaller y), for schematic legs. */
function arc(a: Pt, b: Pt, bend: number): Pt[] {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  let nx = -dy / L, ny = dx / L;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const c: Pt = [mx + nx * L * Math.abs(bend), my + ny * L * Math.abs(bend)];
  const out: Pt[] = [];
  for (let i = 0; i <= 96; i++) {
    const t = i / 96, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

export function buildRoutes(): SegGeom[] {
  return SEGMENTS.map((seg) => {
    let pts: Pt[];
    let km: number | undefined;
    const g = geomById.get(seg.id);
    if (seg.mode === "schematic" || !g) {
      pts = arc(PLACES.get(seg.from)!.xy, PLACES.get(seg.to)!.xy, seg.mode === "schematic" ? seg.bend ?? 0.2 : 0);
      km = g?.km; // traced separately, when the leg has an osmRoute
    } else {
      pts = g.coords.map(([lon, lat]) => project(lon, lat));
      km = g.km;
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const path = new Path2D();
    pts.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
    return {
      seg, pts, cum, len: cum[cum.length - 1], km,
      bbox: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
      path,
    };
  });
}

/** Point and tangent angle at fraction t along a polyline. */
export function along(g: SegGeom, t: number): { p: Pt; angle: number } {
  const target = g.len * Math.max(0, Math.min(1, t));
  let i = 1;
  while (i < g.cum.length - 1 && g.cum[i] < target) i++;
  const a = g.pts[i - 1], b = g.pts[i];
  const segLen = g.cum[i] - g.cum[i - 1] || 1;
  const f = (target - g.cum[i - 1]) / segLen;
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/** Rail kilometres measured along OSM geometry (includes traced schematic legs; rides and transfers excluded). */
export const railKm = (routes: SegGeom[]) =>
  routes.filter((r) => r.seg.mode === "rail" || r.seg.mode === "schematic").reduce((s, r) => s + (r.km ?? 0), 0);

export const placeName = (id: string) => {
  const p = PLACES.get(id);
  return p ? ("city" in p ? p.city : p.name) : id;
};
