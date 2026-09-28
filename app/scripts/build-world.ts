/**
 * Builds src/data/generated/world.topo.json: simplified world countries in lon/lat (unprojected) for the
 * zoomed-out world view (src/components/WorldView.tsx). Source: Natural Earth 1:10m admin-0 (public domain),
 * expected in ../scripts/.cache (see build-basemap.ts). Run: npx tsx scripts/build-world.ts
 */
import * as shp from "shapefile";
import { topology } from "topojson-server";
import { presimplify, simplify, quantile, filter, filterWeight } from "topojson-simplify";
import { quantize } from "topojson-client";
import { writeFileSync } from "node:fs";
import type { Feature } from "geojson";

const src = await shp.open("../scripts/.cache/ne_10m_admin_0_countries/ne_10m_admin_0_countries.shp", undefined, { encoding: "utf-8" });
const features: Feature[] = [];
for (let r = await src.read(); !r.done; r = await src.read()) {
  const f = r.value as Feature;
  const a3 = String(f.properties?.ADM0_A3 ?? "").replace(/\0+$/g, "").trim();
  if (a3 === "ATA") continue; // Antarctica: a huge empty band at the bottom of the map
  features.push({ ...f, properties: { a3 } });
}
let topo = topology({ countries: { type: "FeatureCollection", features } } as any, 1e6);
topo = presimplify(topo as any);
topo = simplify(topo as any, quantile(topo as any, 0.04));
// drop islands too small to see at world scale (quantile = share of points kept)
topo = filter(topo as any, filterWeight(topo as any, quantile(topo as any, 0.04)));
topo = quantize(topo as any, 2e4);
writeFileSync("src/data/generated/world.topo.json", JSON.stringify(topo));
console.log("world bytes", JSON.stringify(topo).length);
