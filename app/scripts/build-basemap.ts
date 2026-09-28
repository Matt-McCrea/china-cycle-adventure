/**
 * Builds src/data/generated/basemap.topo.json (planar, pre-projected) and
 * scripts/.cache/relief_proj.raw from Natural Earth. Run: npx tsx scripts/build-basemap.ts
 * Source data: Natural Earth (public domain), https://www.naturalearthdata.com
 */
import * as shp from "shapefile";
import { geoProject } from "d3-geo-projection";
import { geoCentroid, geoClipRectangle, geoTransform } from "d3-geo";
import { topology } from "topojson-server";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { quantize } from "topojson-client";
import { readFileSync, writeFileSync } from "node:fs";
import type { Feature, FeatureCollection } from "geojson";
import { baseProjection, WORLD_EXTENT } from "../src/map/projection";

const CACHE = "../scripts/.cache";
const proj = baseProjection();
const [[x0, y0], [x1, y1]] = WORLD_EXTENT;

async function load(name: string): Promise<Feature[]> {
  const src = await shp.open(`${CACHE}/${name}/${name}.shp`, undefined, { encoding: "utf-8" });
  const out: Feature[] = [];
  for (let r = await src.read(); !r.done; r = await src.read()) out.push(r.value as Feature);
  return out;
}

// rough lon/lat prefilter before projecting
const inRegion = (f: Feature) => {
  const [lon, lat] = geoCentroid(f);
  return lon > 40 && lon < 160 && lat > 0 && lat < 70;
};

function projectClip(features: Feature[]): FeatureCollection {
  const fc: FeatureCollection = { type: "FeatureCollection", features };
  const projected = geoProject(fc, proj) as FeatureCollection;
  // clip in planar space to the world extent
  const clip = geoClipRectangle(x0, y0, x1, y1);
  const identity = geoTransform({});
  const clipped = geoProject(projected, { stream: (s: any) => identity.stream(clip(s)) } as any) as FeatureCollection;
  clipped.features = clipped.features.filter((f) => f && f.geometry);
  return clipped;
}

const pick = (f: Feature, keys: string[]) => {
  const p: Record<string, unknown> = {};
  for (const k of keys) {
    const v = f.properties?.[k];
    // NE dbf strings are NUL-padded
    if (v != null) p[k] = typeof v === "string" ? v.replace(/\0+$/g, "").trim() : v;
  }
  return { ...f, properties: p };
};

const countries = (await load("ne_10m_admin_0_countries"))
  .filter(inRegion)
  .map((f) => pick(f, ["ADM0_A3", "NAME", "NAME_ZH", "LABEL_X", "LABEL_Y", "MIN_LABEL"]));
const provinces = (await load("ne_10m_admin_1_states_provinces"))
  .filter((f) => f.properties?.adm0_a3 === "CHN")
  .map((f) => pick(f, ["name", "name_zh", "latitude", "longitude"]));
const rivers = (await load("ne_10m_rivers_lake_centerlines"))
  .filter((f) => (f.properties?.scalerank ?? 99) <= 7 && inRegion(f))
  .map((f) => pick(f, ["name", "name_zh", "scalerank"]));
const lakes = (await load("ne_10m_lakes"))
  .filter((f) => (f.properties?.scalerank ?? 99) <= 6 && inRegion(f))
  .map((f) => pick(f, ["name", "scalerank"]));

const layers = {
  countries: projectClip(countries),
  provinces: projectClip(provinces),
  rivers: projectClip(rivers),
  lakes: projectClip(lakes),
};

let topo = topology(layers as any, 1e6);
topo = presimplify(topo as any);
topo = simplify(topo as any, quantile(topo as any, 0.35));
topo = quantize(topo as any, 2e5);
writeFileSync("src/data/generated/basemap.topo.json", JSON.stringify(topo));
console.log("basemap bytes", JSON.stringify(topo).length);

// province label anchors (lon/lat from NE), written for the label engine
const provLabels = provinces.filter((f) => !/群岛/.test(f.properties!.name_zh)).map((f) => ({
  name: f.properties!.name, zh: f.properties!.name_zh,
  lon: f.properties!.longitude, lat: f.properties!.latitude,
}));
writeFileSync("src/data/generated/provinces.json", JSON.stringify(provLabels, null, 1));

// ---- relief: reproject NE GRAY_50M_SR (equirectangular crop) into world units
const meta = JSON.parse(readFileSync(`${CACHE}/relief_crop.json`, "utf8"));
const src = readFileSync(`${CACHE}/relief_crop.raw`);
const PX = 1.6; // pixels per world unit
const W = Math.round((x1 - x0) * PX), H = Math.round((y1 - y0) * PX);
const out = new Uint8Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const ll = proj.invert!([x0 + (i + 0.5) / PX, y0 + (j + 0.5) / PX]);
  let v = 147;
  if (ll) {
    const sx = (ll[0] - meta.lon0) * meta.ppd, sy = (meta.lat0 - ll[1]) * meta.ppd;
    const ix = Math.floor(sx), iy = Math.floor(sy);
    if (ix >= 0 && iy >= 0 && ix < meta.w - 1 && iy < meta.h - 1) {
      const fx = sx - ix, fy = sy - iy, k = iy * meta.w + ix;
      v = (src[k] * (1 - fx) + src[k + 1] * fx) * (1 - fy) + (src[k + meta.w] * (1 - fx) + src[k + meta.w + 1] * fx) * fy;
    }
  }
  out[j * W + i] = v;
}
writeFileSync(`${CACHE}/relief_proj.raw`, out);
writeFileSync(`${CACHE}/relief_proj.json`, JSON.stringify({ w: W, h: H }));
console.log("relief", W, H);
