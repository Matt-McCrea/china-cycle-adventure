import { feature, mesh } from "topojson-client";
import { geoGraticule, geoPath, type GeoPermissibleObjects } from "d3-geo";
import type { Topology, GeometryCollection } from "topojson-specification";
import topoJson from "../data/generated/basemap.topo.json";
import provinces from "../data/generated/provinces.json";
import { baseProjection, WORLD_EXTENT } from "./projection";
import { MAP_CONFIG } from "./config";

/** Basemap layers as Path2D objects in world units, built once. */
export type World = {
  focusLand: Path2D;
  otherLand: Path2D;
  allLand: Path2D;
  coast: Path2D;
  countryBorders: Path2D;
  focusBorder: Path2D;
  provinceBorders: Path2D;
  lakes: Path2D;
  rivers: { path: Path2D; rank: number }[];
  graticule: Path2D;
  countryLabels: { id: string; name: string; x: number; y: number }[];
  provinceLabels: { id: string; name: string; zh: string; x: number; y: number }[];
};

type Props = Record<string, any>;

export function buildWorld(): World {
  const topo = topoJson as unknown as Topology;
  const planar = geoPath(); // basemap is pre-projected: identity
  const toPath = (obj: GeoPermissibleObjects) => {
    const p = new Path2D();
    planar.context(p as any)(obj);
    return p;
  };
  const obj = (k: string) => topo.objects[k] as GeometryCollection<Props>;
  const focus = new Set(MAP_CONFIG.basemap.focus);
  const isFocus = (g: any) => focus.has(g.properties?.ADM0_A3);

  const countries = feature(topo, obj("countries")) as any;
  const focusFc = { type: "FeatureCollection", features: countries.features.filter(isFocus) };
  const otherFc = { type: "FeatureCollection", features: countries.features.filter((f: any) => !isFocus(f)) };

  const rivers = (feature(topo, obj("rivers")) as any).features.map((f: any) => ({
    path: toPath(f),
    rank: f.properties.scalerank as number,
  }));

  const proj = baseProjection();
  const [[x0, y0], [x1, y1]] = WORLD_EXTENT;
  const grat = new Path2D();
  geoPath(proj.clipExtent([[x0, y0], [x1, y1]]), grat as any)(geoGraticule().step([10, 10])());

  const countryLabels = countries.features
    .filter((f: any) => !isFocus(f) && f.properties.LABEL_X != null && (f.properties.MIN_LABEL ?? 9) <= 5)
    .map((f: any) => {
      const p = proj([f.properties.LABEL_X, f.properties.LABEL_Y])!;
      return { id: `c-${f.properties.ADM0_A3}`, name: f.properties.NAME as string, x: p[0], y: p[1] };
    })
    .filter((l: any) => l.x > x0 + 20 && l.x < x1 - 20 && l.y > y0 + 20 && l.y < y1 - 20);

  const provinceLabels = (provinces as { name: string; zh: string; lon: number; lat: number }[]).map((p) => {
    const xy = proj([p.lon, p.lat])!;
    return { id: `p-${p.name}`, name: p.name === "Inner Mongol" ? "Inner Mongolia" : p.name, zh: p.zh, x: xy[0], y: xy[1] };
  });

  return {
    focusLand: toPath(focusFc as any),
    otherLand: toPath(otherFc as any),
    allLand: toPath(countries),
    coast: toPath(mesh(topo, obj("countries"), (a, b) => a === b)),
    countryBorders: toPath(mesh(topo, obj("countries"), (a, b) => a !== b && !isFocus(a) && !isFocus(b))),
    focusBorder: toPath(mesh(topo, obj("countries"), (a, b) => a !== b && isFocus(a) !== isFocus(b))),
    provinceBorders: toPath(mesh(topo, obj("provinces"), (a, b) => a !== b)),
    lakes: toPath(feature(topo, obj("lakes")) as any),
    rivers,
    graticule: grat,
    countryLabels,
    provinceLabels,
  };
}
