/** Draws the route shape (real stop positions, map projection) as the site icon. Run: npx tsx scripts/make-icons.ts */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { STOPS } from "../src/data/itinerary";
import { baseProjection } from "../src/map/projection";

const proj = baseProjection();
const pts = STOPS.map((s) => proj([s.longitude, s.latitude])!);
const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
const S = 180, pad = 30, k = (S - 2 * pad) / Math.max(x1 - x0, y1 - y0);
const ox = (S - (x1 - x0) * k) / 2, oy = (S - (y1 - y0) * k) / 2;
const xy = pts.map(([x, y]) => [ox + (x - x0) * k, oy + (y - y0) * k].map((v) => v.toFixed(1)).join(","));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
<rect width="${S}" height="${S}" rx="36" fill="#efeadf"/>
<polyline points="${xy.join(" ")}" fill="none" stroke="#1d4a44" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${xy[0].split(",")[0]}" cy="${xy[0].split(",")[1]}" r="10" fill="#ad4a22" stroke="#efeadf" stroke-width="3"/>
<circle cx="${xy[xy.length - 1].split(",")[0]}" cy="${xy[xy.length - 1].split(",")[1]}" r="10" fill="#23231e" stroke="#efeadf" stroke-width="3"/>
</svg>`;
writeFileSync("public/favicon.svg", svg);
await sharp(Buffer.from(svg)).png().toFile("public/apple-touch-icon.png");
console.log("icons written");
