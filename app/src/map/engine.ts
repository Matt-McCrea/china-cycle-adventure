import { select, type Selection } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import "d3-transition";
import { easeCubicInOut } from "d3-ease";
import { geoDistance } from "d3-geo";
import reliefUrl from "../assets/relief.jpg";
import { CHAPTERS, CONTEXT_CITIES, IDEAS, PHYSICAL_LABELS, SEGMENTS, STOPS, TRIP } from "../data/itinerary";
import { chinaDate } from "../data/journal";
import type { Stop } from "../data/types";
import { approxKm, dateRange, dateRangeLong, pad2, stopDates } from "../data/format";
import { MAP_CONFIG } from "./config";
import { baseProjection, WORLD_EXTENT } from "./projection";
import { along, buildRoutes, PLACES, project, STOP_XY, type Pt, type SegGeom } from "./routeModel";
import { buildWorld, type World } from "./world";

type Rect = { x0: number; y0: number; x1: number; y1: number };
type Padding = { top: number; right: number; bottom: number; left: number };
type Side = "r" | "l" | "b" | "t" | "br" | "tr" | "bl" | "tl";

export type ViewInfo = { kmPerPx: number; northDeg: number; k: number };
export type SegmentInfo = { id: string; clientX: number; clientY: number };

export type EngineCallbacks = {
  onSelectStop: (id: string | null) => void;
  onSegmentHover: (info: SegmentInfo | null) => void;
  onSegmentClick: (info: SegmentInfo) => void;
  onView: (v: ViewInfo) => void;
  onOpenPost?: (id: string) => void;
};

/** Journal activity at a planned stop: shown as a small photo stuck to its badge (glows when new). */
export type StopMark = { thumb?: string; count: number; isNew: boolean };

/** A journal post as the map needs it: only posts with a real location get a pin. */
export type MapPost = { id: string; title: string; date: string; xy: Pt; thumb?: string; place?: string; ideaId?: string };

const overlaps = (a: Rect, b: Rect, m = 2) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;
const R_EARTH_KM = 6371.0088;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type SecondaryLabel = {
  id: string;
  el: HTMLElement;
  xy: Pt;
  kind: "country" | "province" | "physical" | "chapter" | "city" | "station" | "river" | "idea" | "visit";
  /** place centred on the anchor, or beside a dot */
  mode: "center" | "beside";
  visible: (k: number, poster: boolean) => boolean;
  /** may sit on top of the route if there's no other room (visited-place names) */
  overRoute?: boolean;
  /** distance from the anchor for "beside" labels (default 6px; pins need more) */
  gap?: number;
};

export class MapEngine {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hitCtx: CanvasRenderingContext2D;
  private layer: HTMLDivElement;
  private svg: SVGSVGElement;
  cb: EngineCallbacks;
  private world: World;
  private routes: SegGeom[];
  private relief = new Image();
  private zoomer: ZoomBehavior<HTMLElement, unknown>;
  private sel: Selection<HTMLElement, unknown, null, undefined>;
  private t: ZoomTransform = zoomIdentity;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private fitK = 1;
  private padding: Padding = { top: 24, right: 24, bottom: 24, left: 24 };
  private raf = 0;
  private colors: Record<string, string> = {};
  private reserved: Rect[] = [];

  private active: string | null = null;
  private hoverStop: string | null = null;
  private hoverSeg: string | null = null;
  private reveal: number | null = null;
  private poster = false;

  private badges = new Map<string, HTMLButtonElement>();
  private posts: MapPost[] = [];
  private postPins = new Map<string, HTMLButtonElement>();
  private actualPath: Path2D | null = null;
  private visitLabels: SecondaryLabel[] = [];
  private marks: Record<string, StopMark> = {};
  private visitedIdeas = new Set<string>();
  private stopLabels = new Map<string, HTMLDivElement>();
  private leaders = new Map<string, { line: SVGLineElement; dot: SVGCircleElement }>();
  private arcLabel: HTMLDivElement;
  private secondary: SecondaryLabel[] = [];
  private sizeCache = new Map<string, { w: number; h: number }>();
  private prevSide = new Map<string, Side>();
  private prevFan = new Map<string, number>();
  private ro: ResizeObserver;
  private mo: MutationObserver;
  private mq: MediaQueryList;

  constructor(el: HTMLElement, cb: EngineCallbacks) {
    this.el = el;
    this.cb = cb;
    this.world = buildWorld();
    this.routes = buildRoutes();

    this.canvas = document.createElement("canvas");
    this.canvas.className = "map-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d")!;
    this.hitCtx = document.createElement("canvas").getContext("2d")!;
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("map-leaders");
    this.svg.setAttribute("aria-hidden", "true");
    this.layer = document.createElement("div");
    this.layer.className = "map-labels";
    el.prepend(this.canvas, this.svg, this.layer);

    this.buildDom();
    this.arcLabel = this.layer.querySelector(".map-arc-label") as HTMLDivElement;

    this.relief.onload = () => this.requestRender();
    this.relief.src = reliefUrl;

    this.zoomer = zoom<HTMLElement, unknown>()
      .filter((e: any) => {
        const t = e.target as HTMLElement;
        // drags that start on a marker or label still pan the map (a plain tap still selects it);
        // panels, cards and buttons are left alone
        const onMarker = !!t.closest?.(".map-badge, .map-slabel, .map-jpin");
        return (!e.ctrlKey || e.type === "wheel") && !e.button && (onMarker || !t.closest?.("[data-map-ui]"));
      })
      .on("zoom", (e) => {
        this.t = e.transform;
        this.requestRender();
      });
    this.sel = select(el);
    this.sel.call(this.zoomer);

    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerleave", () => this.setHoverSeg(null));
    el.addEventListener("click", this.onClick);
    el.addEventListener("keydown", this.onKey);

    this.readColors();
    this.mq = window.matchMedia("(prefers-color-scheme: dark)");
    this.mq.addEventListener("change", this.onTheme);
    this.mo = new MutationObserver(this.onTheme);
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize(true);
    document.fonts?.ready.then(() => {
      // label sizes and the chrome's reserved boxes both change once web fonts arrive
      this.sizeCache.clear();
      this.refreshReserved();
    });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.mo.disconnect();
    this.mq.removeEventListener("change", this.onTheme);
    this.sel.on(".zoom", null);
    this.el.removeEventListener("pointermove", this.onPointerMove);
    this.el.removeEventListener("click", this.onClick);
    this.el.removeEventListener("keydown", this.onKey);
    this.canvas.remove();
    this.svg.remove();
    this.layer.remove();
  }

  // ------------------------------------------------------------------ public API

  setPadding(p: Partial<Padding>) {
    this.padding = { ...this.padding, ...p };
  }

  /** Re-read the screen rectangles that labels must stay clear of. */
  refreshReserved() {
    const box = this.el.getBoundingClientRect();
    this.reserved = [...this.el.querySelectorAll<HTMLElement>("[data-map-reserve]")]
      .filter((n) => n.offsetParent !== null)
      .map((n) => {
        const r = n.getBoundingClientRect();
        return { x0: r.left - box.left, y0: r.top - box.top, x1: r.right - box.left, y1: r.bottom - box.top };
      });
    this.requestRender();
  }

  setActive(id: string | null) {
    this.active = id;
    this.requestRender();
  }

  setPoster(on: boolean) {
    this.poster = on;
    this.el.classList.toggle("is-poster", on);
    this.requestRender();
  }

  /** Number of segments revealed (fractional); null = whole route. */
  setStopMarks(marks: Record<string, StopMark>) {
    this.marks = marks;
    for (const [id, b] of this.badges) {
      const m = marks[id];
      b.querySelector(".bthumb")?.remove();
      b.classList.toggle("has-posts", !!m?.count);
      b.classList.toggle("is-new", !!m?.isNew);
      if (!m?.count) continue;
      const el = document.createElement(m.thumb ? "img" : "span");
      el.className = "bthumb";
      el.setAttribute("aria-hidden", "true");
      if (m.thumb) {
        (el as HTMLImageElement).src = m.thumb;
        (el as HTMLImageElement).alt = "";
      } else el.textContent = String(m.count);
      b.append(el);
      const s = STOPS.find((x) => x.id === id)!;
      b.setAttribute("aria-label", `Stop ${s.number}: ${s.city}, ${dateRangeLong(s.dateStart, s.dateEnd)}, ${m.count} journal ${m.count === 1 ? "post" : "posts"}${m.isNew ? ", new" : ""}`);
    }
    this.requestRender();
  }

  /** Journal posts with exact locations: drawn as pins, joined in date order as "our actual route". */
  setPosts(posts: MapPost[]) {
    for (const el of this.postPins.values()) el.remove();
    this.postPins.clear();
    this.posts = [...posts].sort((a, b) => a.date.localeCompare(b.date));
    const latest = this.posts[this.posts.length - 1]?.id;
    for (const p of this.posts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "map-jpin" + (p.id === latest ? " is-latest" : "");
      b.dataset.mapUi = "";
      b.setAttribute("aria-label", `Journal post: ${p.title}`);
      b.innerHTML = "<span></span>";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cb.onOpenPost?.(b.dataset.ids?.split(",").pop() ?? p.id);
      });
      this.layer.append(b);
      this.postPins.set(p.id, b);
    }
    // name each place we've posted from (skip planned stops: they're already labelled)
    for (const l of this.visitLabels) l.el.remove();
    this.visitLabels = [];
    this.visitedIdeas = new Set(this.posts.map((p) => p.ideaId).filter((x): x is string => !!x));
    const stopNames = new Set(STOPS.map((s) => s.city.toLowerCase()));
    const seen = new Set<string>();
    for (const p of [...this.posts].reverse()) {
      if (!p.place || stopNames.has(p.place.toLowerCase()) || seen.has(p.place.toLowerCase())) continue;
      seen.add(p.place.toLowerCase());
      const el = document.createElement("div");
      el.className = "map-label is-visit";
      el.setAttribute("aria-hidden", "true");
      el.textContent = p.place;
      this.layer.prepend(el);
      this.visitLabels.push({ id: `visit-${p.id}`, kind: "visit", mode: "beside", xy: p.xy, el, visible: (_k, poster) => !poster, overRoute: true, gap: 12 });
    }
    this.actualPath = null;
    // the actual route only joins posts made during the trip (a pre-trip post from home isn't part of it)
    const onTrip = this.posts.filter((p) => chinaDate(p.date) >= TRIP.start);
    if (onTrip.length > 1) {
      this.actualPath = new Path2D();
      onTrip.forEach((p, i) => (i ? this.actualPath!.lineTo(p.xy[0], p.xy[1]) : this.actualPath!.moveTo(p.xy[0], p.xy[1])));
    }
    this.requestRender();
  }

  setReveal(v: number | null) {
    this.reveal = v;
    this.requestRender();
  }

  zoomBy(f: number) {
    this.sel.transition().duration(reducedMotion() ? 0 : 350).call(this.zoomer.scaleBy, f);
  }

  /** The whole of China in one view. */
  fitChina(animate = true) {
    return this.flyToBox(WORLD_EXTENT, animate ? 900 : 0);
  }

  fitAll(animate = true) {
    const pts = [...STOP_XY.values()];
    for (const r of this.routes) pts.push(r.bbox[0], r.bbox[1]);
    return this.flyToBox(this.bboxOf(pts), animate ? 900 : 0);
  }

  /** Fly to a stop, framing it with its arrival leg (play) or its surroundings (click). */
  focusStop(id: string, mode: "stop" | "leg" = "stop", duration?: number) {
    const xy = STOP_XY.get(id)!;
    let box: [Pt, Pt];
    if (mode === "leg") {
      const pts: Pt[] = [xy];
      for (const r of this.routes) if (r.seg.leg === id) pts.push(r.bbox[0], r.bbox[1]);
      box = this.bboxOf(pts);
    } else {
      // ~130 km across, but never zoom out from a closer view the user chose
      const half = 65 / 6.371; // km → world units
      box = [[xy[0] - half, xy[1] - half], [xy[0] + half, xy[1] + half]];
    }
    // never frame tighter than ~40 km for a clicked stop, or ~150 km while playing the journey
    const minSpan = (mode === "leg" ? 150 : 40) / 6.371;
    const cx = (box[0][0] + box[1][0]) / 2, cy = (box[0][1] + box[1][1]) / 2;
    const hw = Math.max((box[1][0] - box[0][0]) / 2, minSpan / 2), hh = Math.max((box[1][1] - box[0][1]) / 2, minSpan / 2);
    return this.flyToBox([[cx - hw, cy - hh], [cx + hw, cy + hh]], duration, mode === "stop");
  }

  // ------------------------------------------------------------------ view maths

  private bboxOf(pts: Pt[]): [Pt, Pt] {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
  }

  private fitTransform([[x0, y0], [x1, y1]]: [Pt, Pt]) {
    const p = this.padding;
    const w = Math.max(40, this.W - p.left - p.right), h = Math.max(40, this.H - p.top - p.bottom);
    const k = Math.min(w / Math.max(x1 - x0, 1e-3), h / Math.max(y1 - y0, 1e-3));
    const tx = p.left + (w - (x1 - x0) * k) / 2 - x0 * k;
    const ty = p.top + (h - (y1 - y0) * k) / 2 - y0 * k;
    return zoomIdentity.translate(tx, ty).scale(k);
  }

  private flyToBox(box: [Pt, Pt], duration?: number, keepCloser = false): Promise<void> {
    let target = this.fitTransform(box);
    const [kMin, kMax] = this.zoomer.scaleExtent();
    let k = Math.max(kMin, Math.min(kMax, target.k));
    if (keepCloser) k = Math.max(k, Math.min(this.t.k, kMax));
    if (k !== target.k) {
      const cx = (box[0][0] + box[1][0]) / 2, cy = (box[0][1] + box[1][1]) / 2;
      const p = this.padding;
      const sx = p.left + (this.W - p.left - p.right) / 2, sy = p.top + (this.H - p.top - p.bottom) / 2;
      target = zoomIdentity.translate(sx - cx * k, sy - cy * k).scale(k);
    }
    const d = reducedMotion() ? 0 : duration ?? 1100;
    return new Promise((resolve) => {
      if (d === 0) {
        this.sel.call(this.zoomer.transform, target);
        resolve();
        return;
      }
      this.sel
        .transition()
        .duration(d)
        .ease(easeCubicInOut)
        .call(this.zoomer.transform, target)
        .on("end interrupt", () => resolve());
    });
  }

  private resize(initial = false) {
    const r = this.el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const wasFit = initial || Math.abs(this.t.k - this.fitK) / this.fitK < 0.02;
    this.W = r.width;
    this.H = r.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.svg.setAttribute("viewBox", `0 0 ${this.W} ${this.H}`);
    const pts = [...STOP_XY.values()];
    for (const rt of this.routes) pts.push(rt.bbox[0], rt.bbox[1]);
    this.fitK = this.fitTransform(this.bboxOf(pts)).k;
    const [[x0, y0], [x1, y1]] = WORLD_EXTENT;
    // zoom out as far as the whole of China (posts can come from anywhere, e.g. Beijing on the way home)
    const chinaK = this.fitTransform(WORLD_EXTENT).k;
    this.zoomer
      .scaleExtent([Math.min(this.fitK * MAP_CONFIG.zoom.min, chinaK), this.fitK * MAP_CONFIG.zoom.max])
      .translateExtent([[x0 - 200, y0 - 200], [x1 + 200, y1 + 200]])
      .extent([[0, 0], [this.W, this.H]]);
    this.refreshReserved();
    if (wasFit) this.fitAll(false);
    else this.requestRender();
  }

  private onTheme = () => {
    this.readColors();
    this.requestRender();
  };

  private readColors() {
    const cs = getComputedStyle(this.el);
    for (const k of ["sea", "sea-line", "land", "land-other", "border", "border-focus", "prov", "river", "lake", "grat",
      "ink", "ink-2", "bike", "rail", "local", "accent", "hi", "actual", "paper", "ghost"])
      this.colors[k] = cs.getPropertyValue(`--map-${k}`).trim() || "#888";
    this.colors.reliefAlpha = cs.getPropertyValue("--map-relief-alpha").trim() || "0.6";
  }

  requestRender = () => {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  };

  private toScreen = (p: Pt): Pt => [p[0] * this.t.k + this.t.x, p[1] * this.t.k + this.t.y];

  private viewInfo(): ViewInfo {
    const proj = baseProjection();
    const cx = this.W / 2, cy = this.H / 2;
    const w = (sx: number, sy: number) => proj.invert!([(sx - this.t.x) / this.t.k, (sy - this.t.y) / this.t.k])!;
    const a = w(cx, cy), b = w(cx + 100, cy);
    const kmPerPx = (geoDistance(a, b) * R_EARTH_KM) / 100;
    const n = project(a[0], Math.min(a[1] + 1, 89));
    const c = project(a[0], a[1]);
    const northDeg = (Math.atan2(n[0] - c[0], -(n[1] - c[1])) * 180) / Math.PI;
    return { kmPerPx, northDeg, k: this.t.k };
  }

  // ------------------------------------------------------------------ state helpers

  private segRevealFrac(i: number) {
    if (this.reveal == null) return 1;
    return Math.max(0, Math.min(1, this.reveal - i));
  }

  private stopReached(s: Stop) {
    if (this.reveal == null || s.number === 1) return true;
    const idx = this.routes.map((r, i) => (r.seg.leg === s.id ? i : -1)).filter((i) => i >= 0);
    return idx.length ? this.segRevealFrac(Math.max(...idx)) >= 1 : true;
  }

  private tierFor(k: number) {
    const T = MAP_CONFIG.tiers;
    let tier = k >= T.kicker ? 3 : k >= T.dates ? 2 : k >= T.chinese ? 1 : 0;
    if (this.poster) tier = Math.max(tier, 2);
    return tier;
  }

  // ------------------------------------------------------------------ DOM

  private buildDom() {
    for (const s of STOPS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "map-badge";
      b.dataset.mapUi = "";
      b.dataset.stop = s.id;
      if (s.bigMoment) b.classList.add("is-moment");
      if (s.tentative) b.classList.add("is-rough");
      b.setAttribute("aria-label", `Stop ${s.number}: ${s.city}, ${dateRangeLong(s.dateStart, s.dateEnd)}`);
      b.innerHTML = `<span>${pad2(s.number)}</span>`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cb.onSelectStop(s.id);
      });
      b.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && this.setHoverStop(s.id));
      b.addEventListener("pointerleave", () => this.setHoverStop(null));
      b.addEventListener("focus", () => this.setHoverStop(s.id));
      b.addEventListener("blur", () => this.setHoverStop(null));
      this.badges.set(s.id, b);

      const l = document.createElement("div");
      l.className = "map-slabel";
      l.dataset.mapUi = "";
      l.setAttribute("aria-hidden", "true");
      l.innerHTML =
        `<span class="en">${s.city}</span><span class="zh" lang="zh-Hans">${s.chineseName}</span>` +
        `<span class="dt">${s.tentative ? "≈ " : ""}${stopDates(s)}${s.tentative ? " · rough plan" : s.confidence === "approximate" ? " · approx." : ""}</span>` +
        `<span class="kick">${s.kicker}</span>`;
      l.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cb.onSelectStop(s.id);
      });
      this.stopLabels.set(s.id, l);

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("r", "2.6");
      this.svg.append(line, dot);
      this.leaders.set(s.id, { line, dot });
    }
    // badges in itinerary order = tab order
    this.layer.append(...this.stopLabels.values(), ...this.badges.values());

    const arc = document.createElement("div");
    arc.className = "map-arc-label";
    const sch = SEGMENTS.find((s) => s.longJourney);
    const schKm = this.routes.find((r) => r.seg === sch)?.km;
    arc.innerHTML = sch
      ? `<b>${sch.service ? `${sch.service} · ` : ""}${dateRange(sch.date, sch.dateEnd)}</b>` +
        `<span>2-day sleeper${schKm ? ` · ${approxKm(schKm)}` : ""}${sch.mode === "schematic" ? " · schematic route" : ""}${sch.serviceStatus === "tbc" ? " · train TBC" : ""}</span>`
      : "";
    this.layer.append(arc);

    const add = (lab: Omit<SecondaryLabel, "el">, html: string) => {
      const el = document.createElement("div");
      el.className = `map-label is-${lab.kind}`;
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = html;
      this.layer.prepend(el);
      this.secondary.push({ ...lab, el });
    };
    const T = MAP_CONFIG.tiers;
    for (const c of CHAPTERS)
      add({ id: `ch-${c.id}`, kind: "chapter", mode: "center", xy: project(c.label.lon, c.label.lat), visible: (k, p) => p || k < T.dates * 1.6 },
        `<i>${c.numeral}</i>${c.title}`);
    for (const w of [...PLACES.values()].filter((p): p is Extract<typeof p, { kind: string }> => "kind" in p && p.kind !== "via"))
      add({ id: `st-${w.id}`, kind: "station", mode: "beside", xy: w.xy, visible: (k) => k >= T.stations },
        `${w.name} <span lang="zh-Hans">${w.chineseName}</span>`);
    for (const i of IDEAS)
      add({ id: `idea-${i.id}`, kind: "idea", mode: "beside", xy: project(i.longitude, i.latitude), visible: (k) => k >= T.chinese && !this.visitedIdeas.has(i.id) },
        `${i.name} <span lang="zh-Hans">${i.chineseName}</span> <em>idea</em>`);
    for (const c of CONTEXT_CITIES)
      add({ id: `city-${c.name}`, kind: "city", mode: "beside", xy: project(c.lon, c.lat), visible: () => true },
        `${c.name} <span lang="zh-Hans">${c.zh}</span>`);
    for (const p of PHYSICAL_LABELS)
      add({ id: `ph-${p.name}`, kind: "physical", mode: "center", xy: project(p.lon, p.lat), visible: (k) => p.size >= 2 || k >= T.chinese },
        `${p.name}${"sub" in p && p.sub ? `<small>${p.sub}</small>` : ""}`);
    for (const c of this.world.countryLabels)
      add({ id: c.id, kind: "country", mode: "center", xy: [c.x, c.y], visible: () => true }, c.name);
    const chapterNames = new Set(CHAPTERS.map((c) => c.title.toLowerCase()));
    for (const p of this.world.provinceLabels.filter((p) => !chapterNames.has(p.name.toLowerCase())))
      add({ id: p.id, kind: "province", mode: "center", xy: [p.x, p.y], visible: (k) => k >= T.provinces && !this.poster },
        `${p.name} <span lang="zh-Hans">${p.zh.replace(/(维吾尔|壮族|回族)?(自治区|省|市)$/, "")}</span>`);
  }

  private setHoverStop(id: string | null) {
    if (this.hoverStop === id) return;
    this.hoverStop = id;
    this.requestRender();
  }

  private setHoverSeg(id: string | null, e?: PointerEvent) {
    if (this.hoverSeg !== id) {
      this.hoverSeg = id;
      this.el.classList.toggle("is-seg-hover", !!id);
      this.requestRender();
    }
    this.cb.onSegmentHover(id && e ? { id, clientX: e.clientX, clientY: e.clientY } : null);
  }

  private hitSegment(sx: number, sy: number): string | null {
    const c = this.hitCtx;
    c.setTransform(this.t.k, 0, 0, this.t.k, this.t.x, this.t.y);
    c.lineWidth = 14 / this.t.k;
    for (let i = this.routes.length - 1; i >= 0; i--) {
      const r = this.routes[i];
      if (this.segRevealFrac(i) <= 0) continue;
      if (c.isPointInStroke(r.path, sx, sy)) return r.seg.id;
    }
    return null;
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    if ((e.target as HTMLElement).closest("[data-map-ui]")) return this.setHoverSeg(null);
    const b = this.el.getBoundingClientRect();
    this.setHoverSeg(this.hitSegment(e.clientX - b.left, e.clientY - b.top), e);
  };

  private onClick = (e: MouseEvent) => {
    if (e.target !== this.canvas && e.target !== this.layer && e.target !== this.el) return;
    const b = this.el.getBoundingClientRect();
    const id = this.hitSegment(e.clientX - b.left, e.clientY - b.top);
    if (id) this.cb.onSegmentClick({ id, clientX: e.clientX, clientY: e.clientY });
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.target !== this.el) return;
    const step = 80;
    const pan = (dx: number, dy: number) => this.sel.transition().duration(reducedMotion() ? 0 : 200).call(this.zoomer.translateBy, dx / this.t.k, dy / this.t.k);
    switch (e.key) {
      case "ArrowLeft": pan(step, 0); break;
      case "ArrowRight": pan(-step, 0); break;
      case "ArrowUp": pan(0, step); break;
      case "ArrowDown": pan(0, -step); break;
      case "+": case "=": this.zoomBy(1.6); break;
      case "-": case "_": this.zoomBy(1 / 1.6); break;
      case "0": this.fitAll(); break;
      default: return;
    }
    e.preventDefault();
  };

  private measure(el: HTMLElement, key: string) {
    let s = this.sizeCache.get(key);
    if (!s) {
      s = { w: el.offsetWidth, h: el.offsetHeight };
      if (s.w) this.sizeCache.set(key, s);
    }
    return s;
  }

  // ------------------------------------------------------------------ render

  private render() {
    if (!this.W) return;
    this.drawCanvas();
    this.layout();
    this.cb.onView(this.viewInfo());
  }

  private drawCanvas() {
    const { ctx, t, dpr, colors: C, world } = this;
    const k = t.k;
    const px = 1 / k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = C.sea;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * t.x, dpr * t.y);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // graticule
    ctx.strokeStyle = C.grat;
    ctx.lineWidth = 0.6 * px;
    ctx.stroke(world.graticule);

    // vintage water-lining along the coast
    ctx.strokeStyle = C["sea-line"];
    for (const [w, a] of [[15, 0.18], [9, 0.3], [4, 0.45]] as const) {
      ctx.globalAlpha = a;
      ctx.lineWidth = w * px;
      ctx.stroke(world.coast);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.sea;
      ctx.lineWidth = (w - 2) * px;
      ctx.stroke(world.coast);
      ctx.strokeStyle = C["sea-line"];
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = C["land-other"];
    ctx.fill(world.otherLand);
    ctx.fillStyle = C.land;
    ctx.fill(world.focusLand);

    // relief (soft-light around a neutral grey)
    if (this.relief.complete && this.relief.naturalWidth) {
      const [[x0, y0], [x1, y1]] = WORLD_EXTENT;
      ctx.save();
      ctx.clip(world.allLand);
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = parseFloat(C.reliefAlpha);
      ctx.drawImage(this.relief, x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    }

    ctx.fillStyle = C.lake;
    ctx.fill(world.lakes);
    ctx.strokeStyle = C.river;
    for (const r of world.rivers) {
      if (r.rank > 5 && k < 1.2) continue;
      ctx.lineWidth = (r.rank <= 3 ? 1.1 : r.rank <= 5 ? 0.8 : 0.55) * px;
      ctx.stroke(r.path);
    }

    ctx.strokeStyle = C.prov;
    ctx.lineWidth = 0.7 * px;
    ctx.setLineDash([2.5 * px, 2 * px]);
    ctx.stroke(world.provinceBorders);
    ctx.setLineDash([]);

    ctx.strokeStyle = C.border;
    ctx.lineWidth = 0.8 * px;
    ctx.stroke(world.countryBorders);
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 5 * px;
    ctx.strokeStyle = C["border-focus"];
    ctx.stroke(world.focusBorder);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.1 * px;
    ctx.stroke(world.focusBorder);

    // context cities
    ctx.fillStyle = C["ink-2"];
    for (const c of CONTEXT_CITIES) {
      const [x, y] = project(c.lon, c.lat);
      ctx.beginPath();
      ctx.arc(x, y, 2 * px, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawRoutes();
    ctx.globalAlpha = 1;

    // ideas for the loose second half: small hollow dots (gone once visited: the post pin takes over)
    ctx.strokeStyle = C.actual;
    ctx.fillStyle = C.paper;
    ctx.lineWidth = 1.4 * px;
    for (const i of IDEAS) {
      if (this.visitedIdeas.has(i.id) || this.poster) continue;
      const [x, y] = project(i.longitude, i.latitude);
      ctx.beginPath();
      ctx.arc(x, y, 3.2 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // our actual route, joining located journal posts in date order
    if (this.actualPath && this.reveal == null) {
      ctx.strokeStyle = C.actual;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.6 * px;
      ctx.setLineDash([1.5 * px, 3.5 * px]);
      ctx.stroke(this.actualPath);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // stations & transfers
    if (k >= MAP_CONFIG.tiers.stations * 0.6) {
      const used = new Set(SEGMENTS.flatMap((s) => [s.from, s.to]));
      for (const p of PLACES.values()) {
        if ("number" in p || p.kind === "via" || !used.has(p.id)) continue;
        const s = 5 * px;
        ctx.fillStyle = C.paper;
        ctx.strokeStyle = C.rail;
        ctx.lineWidth = 1.4 * px;
        ctx.beginPath();
        ctx.rect(p.xy[0] - s / 2, p.xy[1] - s / 2, s, s);
        ctx.fill();
        ctx.stroke();
      }
    }

    // uncertainty rings for approximate stops
    if (k >= 4) {
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.2 * px;
      ctx.setLineDash([2 * px, 2.5 * px]);
      for (const s of STOPS) {
        if (s.confidence !== "approximate") continue;
        const [x, y] = STOP_XY.get(s.id)!;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(20 * px, 1.5 / 6.371), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  private partialPath(g: SegGeom, f: number) {
    if (f >= 1) return g.path;
    const p = new Path2D();
    const target = g.len * f;
    p.moveTo(g.pts[0][0], g.pts[0][1]);
    for (let i = 1; i < g.pts.length; i++) {
      if (g.cum[i] >= target) {
        const e = along(g, f).p;
        p.lineTo(e[0], e[1]);
        break;
      }
      p.lineTo(g.pts[i][0], g.pts[i][1]);
    }
    return p;
  }

  /** Polyline shifted sideways by a constant screen distance (left of travel direction). */
  private offsetPath(g: SegGeom, f: number, px: number) {
    const d = px / this.t.k;
    const target = g.len * f;
    const pts: Pt[] = [];
    for (let i = 0; i < g.pts.length && g.cum[i] <= target; i++) pts.push(g.pts[i]);
    if (f < 1) pts.push(along(g, f).p);
    const p = new Path2D();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const x = pts[i][0] + ((b[1] - a[1]) / L) * d, y = pts[i][1] - ((b[0] - a[0]) / L) * d;
      if (i) p.lineTo(x, y); else p.moveTo(x, y);
    }
    return p;
  }

  private drawRoutes() {
    const { ctx, colors: C } = this;
    const px = (this.W < 560 ? 1.3 : 1) / this.t.k; // phones: thicker lines
    const focus = this.hoverStop ?? this.active;

    // ghost of the whole route while the journey is playing
    if (this.reveal != null) {
      ctx.strokeStyle = C.ghost;
      ctx.lineWidth = 2 * px;
      for (const r of this.routes) {
        ctx.setLineDash(r.seg.mode === "rail" || r.seg.mode === "bike" ? [] : [3 * px, 4 * px]);
        ctx.stroke(r.path);
      }
      ctx.setLineDash([]);
    }

    const order = this.routes.map((r, i) => ({ r, i }));
    // highlighted legs last so they sit on top
    order.sort((a, b) => Number(a.r.seg.leg === focus) - Number(b.r.seg.leg === focus));
    for (const { r, i } of order) {
      const f = this.segRevealFrac(i);
      if (f <= 0) continue;
      const path = r.seg.offsetPx ? this.offsetPath(r, f, r.seg.offsetPx) : this.partialPath(r, f);
      const hi = r.seg.leg === focus;
      // rough-plan legs are drawn faded unless highlighted
      ctx.globalAlpha = !hi && STOPS.find((s) => s.id === r.seg.leg)?.tentative ? 0.5 : 1;
      const hov = r.seg.id === this.hoverSeg;
      const col = hi ? C.hi : r.seg.mode === "local" ? C.local : r.seg.mode === "bike" ? C.bike : C.rail;
      const extra = hov ? 1.2 : 0;
      if (r.seg.mode === "bike") {
        // the ride itself: a bold solid line with a paper casing
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = (7 + extra) * px;
        ctx.stroke(path);
        ctx.strokeStyle = col;
        ctx.lineWidth = (4.2 + extra) * px;
        ctx.stroke(path);
      } else if (r.seg.mode === "rail") {
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = (6 + extra) * px;
        ctx.stroke(path);
        ctx.strokeStyle = col;
        ctx.lineWidth = (3.4 + extra) * px;
        ctx.stroke(path);
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = 1.1 * px;
        ctx.lineCap = "butt";
        ctx.setLineDash([6 * px, 6 * px]);
        ctx.stroke(path);
        ctx.setLineDash([]);
        ctx.lineCap = "round";
      } else if (r.seg.mode === "local") {
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = (3.6 + extra) * px;
        ctx.stroke(path);
        ctx.strokeStyle = col;
        ctx.lineWidth = (1.7 + extra) * px;
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.stroke(path);
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = col;
        ctx.lineWidth = (2.8 + extra) * px;
        ctx.setLineDash([0.01 * px, 7 * px]);
        ctx.stroke(path);
        ctx.setLineDash([]);
      }
      // direction arrow at the middle of long-enough legs
      if (f >= 0.55 && r.len * this.t.k > 110 && r.seg.mode !== "local") {
        const { p, angle } = along(r, 0.5);
        ctx.save();
        ctx.translate(p[0], p[1]);
        ctx.rotate(angle);
        ctx.beginPath();
        const s = r.seg.mode === "bike" ? 3 * px : r.seg.mode === "rail" ? 2.6 * px : 5 * px;
        ctx.moveTo(-s, -s);
        ctx.lineTo(s * 0.6, 0);
        ctx.lineTo(-s, s);
        if (r.seg.mode === "rail" || r.seg.mode === "bike") {
          ctx.strokeStyle = C.paper;
          ctx.lineWidth = 1.5 * px;
          ctx.stroke();
        } else {
          ctx.closePath();
          ctx.fillStyle = col;
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------------ labels

  private layout() {
    const k = this.t.k;
    const B = MAP_CONFIG.badge;
    const placed: Rect[] = [];
    const inView = (r: Rect, m = 4) => r.x0 >= m && r.y0 >= m && r.x1 <= this.W - m && r.y1 <= this.H - m;
    const free = (r: Rect, obstacles?: Rect[]) =>
      inView(r) && !this.reserved.some((q) => overlaps(r, q, 4)) && !placed.some((q) => overlaps(r, q)) &&
      !(obstacles && obstacles.some((q) => overlaps(r, q, 0)));

    // route obstacles, sampled in screen space
    const routeObs: Rect[] = [];
    this.routes.forEach((r, i) => {
      if (this.segRevealFrac(i) <= 0 && this.reveal == null) return;
      for (let j = 1; j < r.pts.length; j++) {
        const a = this.toScreen(r.pts[j - 1]), b = this.toScreen(r.pts[j]);
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let s = 0; s < d; s += 9) {
          const x = a[0] + ((b[0] - a[0]) * s) / d, y = a[1] + ((b[1] - a[1]) * s) / d;
          routeObs.push({ x0: x - 3, y0: y - 3, x1: x + 3, y1: y + 3 });
        }
      }
    });

    // ---- 1. badges: singletons sit on their point; crowded stops fan out with leader lines
    const anchors = STOPS.map((s) => ({ s, p: this.toScreen(STOP_XY.get(s.id)!) }));
    const parent = anchors.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < anchors.length; i++)
      for (let j = i + 1; j < anchors.length; j++)
        if (Math.hypot(anchors[i].p[0] - anchors[j].p[0], anchors[i].p[1] - anchors[j].p[1]) < B * 1.08) parent[find(i)] = find(j);
    const clusters = new Map<number, typeof anchors>();
    anchors.forEach((a, i) => (clusters.get(find(i)) ?? clusters.set(find(i), []).get(find(i))!).push(a));

    const badgePos = new Map<string, Pt>();
    const fanDir = new Map<string, Pt>();
    const singles = [...clusters.values()].filter((c) => c.length === 1).map((c) => c[0]);
    for (const a of singles) badgePos.set(a.s.id, a.p);
    const singleRects = singles.map((a) => ({ x0: a.p[0] - B / 2, y0: a.p[1] - B / 2, x1: a.p[0] + B / 2, y1: a.p[1] + B / 2 }));

    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      const key = members.map((m) => m.s.id).join("|");
      const c: Pt = [members.reduce((s, m) => s + m.p[0], 0) / members.length, members.reduce((s, m) => s + m.p[1], 0) / members.length];
      const n = members.length;
      const R = B * 0.9 + 22 + (n > 2 ? (n - 2) * 5 : 0);
      let best: { score: number; th: number; pos: Pt[]; order: typeof members } | null = null;
      for (let d = 0; d < 16; d++) {
        const th = (d / 16) * Math.PI * 2;
        const u: Pt = [Math.cos(th), Math.sin(th)], v: Pt = [-u[1], u[0]];
        const order = [...members].sort((a, b) => (a.p[0] - c[0]) * v[0] + (a.p[1] - c[1]) * v[1] - ((b.p[0] - c[0]) * v[0] + (b.p[1] - c[1]) * v[1]));
        const pos = order.map((_, j) => [c[0] + u[0] * R + v[0] * (j - (n - 1) / 2) * (B + 5), c[1] + u[1] * R + v[1] * (j - (n - 1) / 2) * (B + 5)] as Pt);
        let score = 0;
        for (const p of pos) {
          const r = { x0: p[0] - B / 2, y0: p[1] - B / 2, x1: p[0] + B / 2, y1: p[1] + B / 2 };
          if (!inView(r, 6)) score += 1000;
          for (const q of singleRects) if (overlaps(r, q, 4)) score += 500;
          for (const q of this.reserved) if (overlaps(r, q, 4)) score += 300;
          for (const q of routeObs) if (overlaps(r, q, 0)) score += 6;
        }
        // prefer fanning sideways: a vertical stack keeps every label on its own line
        score += (1 - Math.abs(Math.cos(th))) * 18 + (1 - Math.cos(th)) * 2;
        const prev = this.prevFan.get(key);
        if (prev != null && Math.abs(prev - th) < 1e-6) score -= 14;
        if (!best || score < best.score) best = { score, th, pos, order };
      }
      this.prevFan.set(key, best!.th);
      best!.order.forEach((m, j) => {
        badgePos.set(m.s.id, best!.pos[j]);
        fanDir.set(m.s.id, [Math.cos(best!.th), Math.sin(best!.th)]);
      });
    }

    for (const a of anchors) {
      const id = a.s.id;
      const bp = badgePos.get(id)!;
      const b = this.badges.get(id)!;
      b.style.transform = `translate(${bp[0] - B / 2}px, ${bp[1] - B / 2}px) scale(var(--s, 1))`;
      b.classList.toggle("is-active", this.active === id);
      b.classList.toggle("is-future", !this.stopReached(a.s));
      placed.push({ x0: bp[0] - B / 2, y0: bp[1] - B / 2, x1: bp[0] + B / 2, y1: bp[1] + B / 2 });
      // the photo stuck to the badge's top-right shoulder is part of the marker too
      if (this.marks[id]?.count) placed.push({ x0: bp[0] + B / 2 - 8, y0: bp[1] - B / 2 - 18, x1: bp[0] + B / 2 + 18, y1: bp[1] - B / 2 + 8 });
      const { line, dot } = this.leaders.get(id)!;
      const displaced = Math.hypot(bp[0] - a.p[0], bp[1] - a.p[1]) > 1;
      line.style.display = dot.style.display = displaced ? "" : "none";
      if (displaced) {
        line.setAttribute("x1", `${a.p[0]}`); line.setAttribute("y1", `${a.p[1]}`);
        line.setAttribute("x2", `${bp[0]}`); line.setAttribute("y2", `${bp[1]}`);
        dot.setAttribute("cx", `${a.p[0]}`); dot.setAttribute("cy", `${a.p[1]}`);
        line.classList.toggle("is-active", this.active === id);
        dot.classList.toggle("is-active", this.active === id);
      }
    }

    // ---- 1b. journal pins at their true positions; pins closer than 14px merge (newest wins)
    const pinGroups: { ids: string[]; p: Pt }[] = [];
    for (const post of this.posts) {
      const p = this.toScreen(post.xy);
      const g = pinGroups.find((g) => Math.hypot(g.p[0] - p[0], g.p[1] - p[1]) < 14);
      if (g) { g.ids.push(post.id); g.p = p; } else pinGroups.push({ ids: [post.id], p });
    }
    const shown = new Set<string>();
    for (const g of pinGroups) {
      const id = g.ids[g.ids.length - 1];
      const el = this.postPins.get(id)!;
      shown.add(id);
      el.dataset.ids = g.ids.join(",");
      el.dataset.count = g.ids.length > 1 ? String(g.ids.length) : "";
      // a post sent from a stop would hide its number: tuck the pin onto the badge's shoulder instead
      let [px, py] = g.p;
      for (const bp of badgePos.values())
        if (Math.abs(bp[0] - px) < B / 2 + 6 && Math.abs(bp[1] - py) < B / 2 + 6) { px = bp[0] + B / 2 - 1; py = bp[1] + B / 2 - 1; break; }
      g.p = [px, py];
      el.style.transform = `translate(${g.p[0] - 7}px, ${g.p[1] - 7}px) scale(var(--s, 1))`;
      el.style.visibility = this.reveal == null && !this.poster ? "visible" : "hidden";
      if (this.reveal == null && !this.poster) placed.push({ x0: g.p[0] - 7, y0: g.p[1] - 7, x1: g.p[0] + 7, y1: g.p[1] + 7 });
    }
    for (const [id, el] of this.postPins) if (!shown.has(id)) el.style.visibility = "hidden";

    // ---- 2. stop labels, active/hovered first, falling back to less detail before giving up
    const tier = this.tierFor(k);
    const order = [...STOPS].sort((a, b) => {
      const pa = a.id === this.active ? -2 : a.id === this.hoverStop ? -1 : a.number;
      const pb = b.id === this.active ? -2 : b.id === this.hoverStop ? -1 : b.number;
      return pa - pb;
    });
    for (const s of order) {
      const el = this.stopLabels.get(s.id)!;
      const bp = badgePos.get(s.id)!;
      const want = s.minor && tier < 2 && s.id !== this.active && s.id !== this.hoverStop ? -1 : tier;
      let done = false;
      for (let tr = want; tr >= 0 && !done; tr--) {
        el.dataset.tier = String(tr);
        const { w, h } = this.measure(el, `${s.id}:${tr}`);
        const r = B / 2 + 5;
        const lineH = 16;
        const cand: Record<Side, Pt> = {
          r: [bp[0] + r, bp[1] - lineH / 2 - 1],
          l: [bp[0] - r - w, bp[1] - lineH / 2 - 1],
          b: [bp[0] - w / 2, bp[1] + r - 2],
          t: [bp[0] - w / 2, bp[1] - r - h + 2],
          br: [bp[0] + r - 6, bp[1] + r - 6],
          tr: [bp[0] + r - 6, bp[1] - r - h + 6],
          bl: [bp[0] - r - w + 6, bp[1] + r - 6],
          tl: [bp[0] - r - w + 6, bp[1] - r - h + 6],
        };
        let sides: Side[] = ["r", "l", "b", "t", "br", "tr", "bl", "tl"];
        const fd = fanDir.get(s.id);
        if (fd) sides.sort((a, b) => sideScore(b, fd) - sideScore(a, fd));
        const prev = this.prevSide.get(s.id);
        if (prev) sides = [prev, ...sides.filter((x) => x !== prev)];
        for (const pass of [routeObs, undefined]) {
          for (const side of sides) {
            let [x, y] = cand[side];
            // labels above/below a badge may slide sideways to stay on screen (e.g. a stop at the screen edge)
            if (side === "t" || side === "b") x = Math.max(6, Math.min(this.W - 6 - w, x));
            const rect = { x0: x, y0: y, x1: x + w, y1: y + h };
            if (free(rect, pass)) {
              placed.push(rect);
              el.style.transform = `translate(${x}px, ${y}px)`;
              el.style.visibility = "visible";
              el.dataset.side = side;
              this.prevSide.set(s.id, side);
              done = true;
              break;
            }
          }
          if (done) break;
        }
      }
      if (!done) el.style.visibility = "hidden";
      el.classList.toggle("is-active", s.id === this.active || s.id === this.hoverStop);
      el.classList.toggle("is-future", !this.stopReached(s));
    }

    // ---- 3. schematic-leg label, riding the outside of the arc
    const sch = this.routes.findIndex((r) => r.seg.longJourney);
    let arcPlaced = false;
    if (sch >= 0 && this.segRevealFrac(sch) > 0.5) {
      const g = this.routes[sch];
      const { w, h } = this.measure(this.arcLabel, "arc");
      // schematic arcs: label the middle; real track: prefer the stretch no other leg uses (Chengdu → Lanzhou)
      const fs = g.seg.mode === "schematic" ? [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74] : [0.14, 0.1, 0.18, 0.06, 0.3, 0.45, 0.6];
      for (const f of fs) {
        const { p } = along(g, f);
        // tangent over a longer stretch so the label doesn't follow every curve in the track
        const p0 = along(g, Math.max(0, f - 0.025)).p, p1 = along(g, Math.min(1, f + 0.025)).p;
        const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const sp = this.toScreen(p);
        let a = angle;
        if (a > Math.PI / 2) a -= Math.PI;
        if (a < -Math.PI / 2) a += Math.PI;
        const nx = Math.sin(a), ny = -Math.cos(a); // outward (up) normal
        const cx = sp[0] + nx * (h / 2 + 7), cy = sp[1] + ny * (h / 2 + 7);
        const ex = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2;
        const ey = (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h) / 2;
        const rect = { x0: cx - ex, y0: cy - ey, x1: cx + ex, y1: cy + ey };
        if (free(rect)) {
          placed.push(rect);
          this.arcLabel.style.transform = `translate(${cx - w / 2}px, ${cy - h / 2}px) rotate(${(a * 180) / Math.PI}deg)`;
          arcPlaced = true;
          break;
        }
      }
    }
    this.arcLabel.style.visibility = arcPlaced ? "visible" : "hidden";
    const lj = SEGMENTS.find((s) => s.longJourney)?.leg;
    this.arcLabel.classList.toggle("is-active", !!lj && (this.active === lj || this.hoverStop === lj));

    // ---- 4. everything else, never on top of the route
    for (const lab of [...this.visitLabels, ...this.secondary]) {
      const el = lab.el;
      if (!lab.visible(k, this.poster)) {
        el.style.visibility = "hidden";
        continue;
      }
      const sp = this.toScreen(lab.xy);
      const { w, h } = this.measure(el, lab.id);
      const cands: Pt[] = lab.mode === "center"
        ? [[sp[0] - w / 2, sp[1] - h / 2]]
        : (() => {
            const g = lab.gap ?? 6;
            return [[sp[0] + g, sp[1] - h / 2], [sp[0] - g - w, sp[1] - h / 2], [sp[0] - w / 2, sp[1] + g - 1], [sp[0] - w / 2, sp[1] - g + 1 - h]] as Pt[];
          })();
      let ok = false;
      for (const pass of lab.overRoute ? [routeObs, undefined] : [routeObs]) {
        for (const [x, y] of cands) {
          const rect = { x0: x, y0: y, x1: x + w, y1: y + h };
          if (free(rect, pass)) {
            placed.push(rect);
            el.style.transform = `translate(${x}px, ${y}px)`;
            ok = true;
            break;
          }
        }
        if (ok) break;
      }
      el.style.visibility = ok ? "visible" : "hidden";
    }
  }
}

function sideScore(side: Side, d: Pt) {
  const v: Record<Side, Pt> = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1], br: [0.7, 0.7], tr: [0.7, -0.7], bl: [-0.7, 0.7], tl: [-0.7, -0.7] };
  return v[side][0] * d[0] + v[side][1] * d[1];
}
