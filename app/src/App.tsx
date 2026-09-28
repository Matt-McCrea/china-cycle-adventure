import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapEngine, type SegmentInfo, type ViewInfo } from "./map/engine";
import { buildRoutes, placeName } from "./map/routeModel";
import { MAP_CONFIG } from "./map/config";
import { SEGMENTS, STOPS, TRIP } from "./data/itinerary";
import { dateRange } from "./data/format";
import { StopCard, LegLine, type SegLengths } from "./components/StopCard";
import { JournalButton, JournalPanel, NewPopup, PostViewer, timeAgo } from "./components/Journal";
import { WorldView } from "./components/WorldView";
import type { JournalEntry, JournalFile } from "./data/journal";
import { project } from "./map/routeModel";

const SEEN_KEY = "china-cycle-adventure:journal-seen";
const WELCOME_KEY = "china-cycle-adventure:welcomed";
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const writeSeen = (iso: string) => {
  try {
    localStorage.setItem(SEEN_KEY, iso);
  } catch {
    /* private mode: popup just shows again next time */
  }
};

const useMedia = (q: string) => {
  const [m, set] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => set(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
};
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function niceScale(kmPerPx: number, maxPx = 84) {
  const raw = kmPerPx * maxPx;
  const p = 10 ** Math.floor(Math.log10(raw));
  const km = [5, 2, 1].map((m) => m * p).find((v) => v <= raw) ?? p;
  return { km, px: km / kmPerPx };
}

export default function App() {
  const mapRef = useRef<HTMLDivElement>(null);
  const engine = useRef<MapEngine | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<ViewInfo | null>(null);
  const [hoverSeg, setHoverSeg] = useState<SegmentInfo | null>(null);
  const [pinnedSeg, setPinnedSeg] = useState<SegmentInfo | null>(null);
  const [poster, setPoster] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const playState = useRef({ stop: false, step: 0, reveal: 0 });
  const mobile = useMedia("(max-width: 720px)");
  const [posts, setPosts] = useState<JournalEntry[]>([]);
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [news, setNews] = useState<{ posts: JournalEntry[]; first: boolean } | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  /** zoomed out past China: the whole world, for posts from anywhere */
  const [worldOpen, setWorldOpen] = useState(() => window.location.hash === "#world");
  /** posts that are new to this visitor (since their last visit; for a first visit, the last 3 days) */
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  // first visit (and no deep link): introduce the map before anything else
  const [welcome, setWelcome] = useState(() => {
    try {
      return !localStorage.getItem(WELCOME_KEY) && !window.location.hash;
    } catch {
      return !window.location.hash;
    }
  });
  const closeWelcome = () => {
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      /* ignore */
    }
    setWelcome(false);
  };

  // ---- journal: fetched at runtime so new posts show without a rebuild of the app code
  useEffect(() => {
    fetch(`journal/entries.json?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: JournalFile | null) => {
        const list = (j?.entries ?? []).filter((e) => !e.hidden);
        setPosts(list);
        if (!list.length) return;
        const seen = readSeen();
        const fresh = seen ? list.filter((e) => e.date > seen) : list;
        const h = decodeURIComponent(window.location.hash);
        if (h.startsWith("#post:") && list.some((e) => e.id === h.slice(6))) setOpenPost(h.slice(6));
        else if (fresh.length && !h.includes("poster")) setNews({ posts: fresh, first: !seen });
        const recent = Date.now() - 3 * 86400e3;
        setFreshIds(new Set((seen ? fresh : list.filter((e) => new Date(e.date).getTime() > recent)).map((e) => e.id)));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    engine.current?.setPosts(
      posts
        .filter((p) => p.locSource !== "plan" && p.lat != null && p.lon != null)
        .map((p) => ({ id: p.id, title: p.title, date: p.date, xy: project(p.lon!, p.lat!), thumb: p.photos[0]?.thumb, place: p.place?.name, ideaId: p.place?.ideaId })),
    );
  }, [posts]);
  // engine callbacks are bound once; point them at the latest closures
  useEffect(() => {
    if (engine.current) engine.current.cb.onOpenPost = showPost;
  });
  // light up stops that have posts: latest photo on the badge, glowing if new to this visitor
  useEffect(() => {
    const marks: Record<string, { thumb?: string; count: number; isNew: boolean }> = {};
    for (const p of posts) {
      const m = (marks[p.stopId] ??= { count: 0, isNew: false });
      m.count++;
      if (p.photos[0]) m.thumb = p.photos[0].thumb; // posts are in date order: ends on the latest
      if (freshIds.has(p.id)) m.isNew = true;
    }
    engine.current?.setStopMarks(marks);
  }, [posts, freshIds]);
  const markSeen = () => {
    if (posts.length) writeSeen(posts[posts.length - 1].date);
    setNews(null);
  };
  const showPost = (id: string) => {
    markSeen();
    setJournalOpen(false);
    setOpenPost(id);
  };

  const routes = useMemo(() => buildRoutes(), []);
  const lengths: SegLengths = useMemo(() => new Map(routes.map((r) => [r.seg.id, r.km])), [routes]);

  // ---- engine lifecycle
  useEffect(() => {
    const e = new MapEngine(mapRef.current!, {
      onSelectStop: (id) => select(id),
      onSegmentHover: setHoverSeg,
      onSegmentClick: (info) => setPinnedSeg(info),
      onView: setView,
      onOpenPost: (id) => showPost(id),
    });
    engine.current = e;
    return () => e.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const padFor = useCallback(
    (cardOpen: boolean) => {
      if (poster) return { top: 150, right: 60, bottom: 150, left: 60 };
      if (mobile) return { top: 170, right: 20, bottom: cardOpen ? Math.round(window.innerHeight * 0.5) : 100, left: 20 };
      // desktop: keep the route clear of the open stop card, or of the journal drawer (46% of the width)
      if (journalOpen) return { top: 210, right: Math.round(Math.min(580, window.innerWidth * 0.46)) + 150, bottom: 80, left: 70 };
      return { top: 210, right: cardOpen ? 400 : 200, bottom: 80, left: 70 };
    },
    [mobile, poster, journalOpen],
  );

  useEffect(() => {
    engine.current?.setPadding(padFor(!!active));
    requestAnimationFrame(() => engine.current?.refreshReserved());
  }, [padFor, active, legendOpen, mobile, poster, pinnedSeg]);
  // re-frame the whole route when the journal drawer opens or closes (desktop)
  useEffect(() => {
    if (!mobile && !active) engine.current?.fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalOpen]);

  const select = useCallback(
    (id: string | null, fly = true) => {
      setActive(id);
      setPinnedSeg(null);
      const e = engine.current!;
      e.setActive(id);
      e.setPadding(padFor(!!id));
      if (id && fly) e.focusStop(id, "stop");
    },
    [padFor],
  );

  // keep engine callback pointing at the latest select()
  useEffect(() => {
    const e = engine.current;
    if (e) e.cb.onSelectStop = (id: string | null) => {
      if (playState.current && playing) playState.current.stop = true;
      select(id);
    };
  }, [select, playing]);

  // ---- keyboard: Esc closes, ←/→ step through stops while a card is open
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (openPost || journalOpen || news) {
        if (ev.key === "Escape") { setJournalOpen(false); if (news) markSeen(); }
        return;
      }
      if (ev.key === "Escape") {
        if (pinnedSeg) setPinnedSeg(null);
        else if (active) select(null, false);
        else if (poster) togglePoster(false);
      }
      if (!active || (ev.target as HTMLElement)?.classList?.contains("map")) return;
      const i = STOPS.findIndex((s) => s.id === active);
      if (ev.key === "ArrowRight" && STOPS[i + 1]) select(STOPS[i + 1].id);
      if (ev.key === "ArrowLeft" && STOPS[i - 1]) select(STOPS[i - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- play journey
  const segIndexFor = (stopId: string) => SEGMENTS.map((s, i) => (s.leg === stopId ? i : -1)).filter((i) => i >= 0);

  const animateReveal = (from: number, to: number, ms: number) =>
    new Promise<void>((resolve) => {
      const e = engine.current!;
      if (reduced() || ms <= 0) {
        playState.current.reveal = to;
        e.setReveal(to);
        return resolve();
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        if (playState.current.stop) return resolve();
        const f = Math.min(1, (now - t0) / ms);
        const eased = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
        playState.current.reveal = from + (to - from) * eased;
        e.setReveal(playState.current.reveal);
        if (f < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

  const play = async (restart = false) => {
    const e = engine.current!;
    const ps = playState.current;
    if (restart || !played || ps.step >= STOPS.length) {
      ps.step = 0;
      ps.reveal = 0;
      e.setReveal(0);
    }
    ps.stop = false;
    setPlaying(true);
    setPlayed(true);
    setPinnedSeg(null);
    e.setPadding(padFor(true));
    while (ps.step < STOPS.length && !ps.stop) {
      const s = STOPS[ps.step];
      const idx = segIndexFor(s.id);
      const to = idx.length ? Math.max(...idx) + 1 : ps.reveal;
      const long = SEGMENTS.slice(Math.floor(ps.reveal), to).some((x) => x.longJourney);
      const dur = long ? 3600 : 1700;
      setActive(null);
      e.setActive(null);
      await Promise.all([e.focusStop(s.id, "leg", dur), animateReveal(ps.reveal, to, dur - 200)]);
      if (ps.stop) break;
      setActive(s.id);
      e.setActive(s.id);
      ps.step++;
      await wait(reduced() ? 3200 : 2600);
    }
    setPlaying(false);
    if (ps.step >= STOPS.length) {
      e.setReveal(null);
      ps.step = STOPS.length;
    }
  };
  const pause = () => {
    playState.current.stop = true;
    setPlaying(false);
  };
  const restart = () => {
    playState.current.stop = true;
    setTimeout(() => play(true), 60);
  };
  const showAll = () => {
    playState.current.stop = true;
    playState.current.step = STOPS.length;
    setPlaying(false);
    engine.current!.setReveal(null);
    select(null, false);
    engine.current!.setPadding(padFor(false));
    engine.current!.fitAll();
  };

  const openWorld = () => {
    if (playing) pause();
    select(null, false);
    setPinnedSeg(null);
    setWorldOpen(true);
  };

  const togglePoster = (on = !poster) => {
    if (on) setWorldOpen(false);
    if (playing) pause();
    engine.current?.setReveal(null);
    setPoster(on);
    setActive(null);
    engine.current?.setActive(null);
    engine.current?.setPoster(on);
  };
  useEffect(() => {
    // poster padding differs; refit after the chrome has changed
    const id = requestAnimationFrame(() => {
      engine.current?.refreshReserved();
      engine.current?.fitAll(!reduced());
    });
    return () => cancelAnimationFrame(id);
  }, [poster]);

  // deep links: #chengdu opens a stop, #poster opens poster view
  useEffect(() => {
    const h = decodeURIComponent(window.location.hash.slice(1));
    if (h === "poster") togglePoster(true);
    else if (STOPS.some((s) => s.id === h)) setTimeout(() => select(h), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const firstHashSync = useRef(true);
  useEffect(() => {
    if (firstHashSync.current) {
      firstHashSync.current = false; // keep the incoming link until it has been acted on
      return;
    }
    try {
      const h = poster ? "#poster" : openPost ? `#post:${openPost}` : worldOpen ? "#world" : active ? `#${active}` : " ";
      history.replaceState(null, "", h === " " ? window.location.pathname + window.location.search : h);
    } catch {
      /* sandboxed viewers may block history writes */
    }
  }, [active, poster, openPost, worldOpen]);

  const stop = STOPS.find((s) => s.id === active) ?? null;
  const seg = pinnedSeg ?? hoverSeg;
  const segData = seg ? SEGMENTS.find((s) => s.id === seg.id) : null;
  const scale = view ? niceScale(view.kmPerPx, mobile ? 64 : 84) : null;
  const mapBox = mapRef.current?.getBoundingClientRect();

  return (
    <main className={`app ${poster ? "is-poster" : ""} ${new URLSearchParams(window.location.search).has("clean") ? "is-clean" : ""}`}>
      <div
        ref={mapRef}
        className="map"
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label="Route map of the cycle tour through Guizhou and Guangxi. Arrow keys pan, plus and minus zoom, 0 shows the whole route. Tab to reach the numbered stops."
      >
        <div className="paper-grain" aria-hidden="true" />

        <header className="title-block" data-map-reserve data-map-ui>
          <p className="eyebrow">{TRIP.travellers} · {TRIP.start.slice(0, 4)}</p>
          <h1 className="title">China Cycle{" "}<br />Adventure</h1>
          <p className="dates">10–19 October 2026</p>
          <p className="corridor">Guiyang → Leigong Shan → Dong villages → Longji terraces → Yangshuo</p>
          {!poster && (
            <button type="button" className="about-link" onClick={() => setWelcome(true)} data-map-ui>
              How this works
            </button>
          )}
          {poster && <p className="strap">{TRIP.strap}</p>}
        </header>

        {poster && (
          <aside className="poster-stats" data-map-reserve data-map-ui aria-label="Journey by numbers">
            <div><b>{TRIP.totals.km}</b><span>km by bike</span></div>
            <div><b>{TRIP.totals.climbM.toLocaleString("en-GB")}</b><span>m of climbing</span></div>
            <div><b>{TRIP.totals.ridingDays}</b><span>riding days</span></div>
            <div><b>1,800</b><span>m high point (approx.), day 3</span></div>
            <div><b>2</b><span>provinces: Guizhou & Guangxi</span></div>
          </aside>
        )}

        <div className="top-right" data-map-ui data-map-reserve>
          {!poster && !mobile && (
            <JournalButton posts={posts} isNew={freshIds.size > 0} open={journalOpen} onClick={() => { markSeen(); setJournalOpen(!journalOpen); }} />
          )}
          {(poster || !mobile) && (
            <button type="button" className="chip" onClick={() => togglePoster()} aria-pressed={poster}>
              {poster ? "Exit poster" : "Poster view"}
            </button>
          )}
        </div>
        {mobile && !poster && !journalOpen && !stop && !openPost && (
          <div className="journal-dock" data-map-ui data-map-reserve>
            <JournalButton posts={posts} isNew={freshIds.size > 0} open={journalOpen} onClick={() => { markSeen(); setJournalOpen(true); }} />
          </div>
        )}

        {welcome && !poster && (
          <Welcome posts={posts} onClose={closeWelcome} onOpenJournal={() => { closeWelcome(); markSeen(); setJournalOpen(true); }} />
        )}
        {news && !welcome && !poster && !openPost && !journalOpen && !stop && (
          <NewPopup posts={news.posts} firstVisit={news.first} onOpen={showPost} onDismiss={markSeen} onOpenJournal={() => { markSeen(); setJournalOpen(true); }} />
        )}
        {journalOpen && !poster && <JournalPanel posts={posts} onOpen={showPost} onClose={() => setJournalOpen(false)} />}
        {openPost && (() => {
          const i = posts.findIndex((p) => p.id === openPost);
          if (i < 0) return null;
          return (
            <PostViewer
              post={posts[i]}
              onClose={() => setOpenPost(null)}
              onPrev={i > 0 ? () => setOpenPost(posts[i - 1].id) : undefined}
              onNext={i < posts.length - 1 ? () => setOpenPost(posts[i + 1].id) : undefined}
            />
          );
        })()}

        {worldOpen && !poster && <WorldView posts={posts} onOpenPost={showPost} onClose={() => setWorldOpen(false)} />}

        {!poster && !worldOpen && (
          <div className="controls" data-map-ui data-map-reserve>
            <div className="ctrl-group" role="group" aria-label="Journey playback">
              {playing ? (
                <button type="button" className="ctrl ctrl-wide" onClick={pause} aria-label="Pause journey">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" /></svg> <span className="ctrl-label">Pause</span>
                </button>
              ) : (
                <button type="button" className="ctrl ctrl-wide ctrl-play" onClick={() => play()} aria-label={played && playState.current.step < STOPS.length ? "Resume journey" : "Play journey"}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z" /></svg>
                  <span className="ctrl-label">{played && playState.current.step > 0 && playState.current.step < STOPS.length ? "Resume" : "Play journey"}</span>
                </button>
              )}
              {played && (
                <>
                  <button type="button" className="ctrl" onClick={restart} aria-label="Restart journey" title="Restart">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v2.5h2.5" /></svg>
                  </button>
                  <button type="button" className="ctrl" onClick={showAll} aria-label="Show the whole route" title="Show whole route">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12l4-6 3 4 2-2 3 4" /></svg>
                  </button>
                </>
              )}
            </div>
            <div className="ctrl-group" role="group" aria-label="Zoom">
              <button type="button" className="ctrl" onClick={() => engine.current?.zoomBy(1.8)} aria-label="Zoom in">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
              </button>
              <button type="button" className="ctrl" onClick={() => (engine.current?.atMinZoom() ? openWorld() : engine.current?.zoomBy(1 / 1.8))} aria-label="Zoom out">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
              </button>
              <button type="button" className="ctrl" onClick={() => { select(null, false); engine.current?.setPadding(padFor(false)); engine.current?.fitAll(); }} aria-label="Fit whole route" title="Whole route">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
              </button>
              <button type="button" className="ctrl" onClick={openWorld} aria-label="Show the whole world" title="Whole world">
                <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c-2.2 2.2-2.2 9.8 0 12M8 2c2.2 2.2 2.2 9.8 0 12" /></svg>
              </button>
              {mobile && (
                <button type="button" className="ctrl" onClick={() => togglePoster(true)} aria-label="Poster view" title="Poster view">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2" width="11" height="12" rx="1" /><path d="M5 11l2-3 2 2 2-3" /></svg>
                </button>
              )}
            </div>
          </div>
        )}

        <div className={`legend-dock ${legendOpen ? "is-open" : ""}`} data-map-ui data-map-reserve hidden={worldOpen && !poster}>
          {mobile && !poster && (
            <button type="button" className="chip legend-toggle" aria-expanded={legendOpen} aria-controls="legend" onClick={() => setLegendOpen(!legendOpen)}>
              Legend
            </button>
          )}
          {(!mobile || legendOpen || poster) && (
            <dl className="legend" id="legend">
              <div><dt><svg width="28" height="8" aria-hidden="true" className="sw sw-bike"><line x1="1" y1="4" x2="27" y2="4" /></svg></dt><dd>Cycling</dd></div>
              <div><dt><svg width="28" height="8" aria-hidden="true" className="sw sw-rail"><line x1="1" y1="4" x2="27" y2="4" /><line className="tie" x1="1" y1="4" x2="27" y2="4" /></svg></dt><dd>Train</dd></div>
              <div><dt><svg width="28" height="8" aria-hidden="true" className="sw sw-local"><line x1="1" y1="4" x2="27" y2="4" /></svg></dt><dd>Transfer</dd></div>
              {posts.some((p) => p.locSource !== "plan") && (
                <div><dt><svg width="28" height="8" aria-hidden="true" className="sw sw-actual"><line x1="2" y1="4" x2="21" y2="4" /><circle cx="24" cy="4" r="3" /></svg></dt><dd>Actual</dd></div>
              )}
              {SEGMENTS.some((s) => s.mode === "schematic") && (
                <div><dt><svg width="28" height="8" aria-hidden="true" className="sw sw-schematic"><line x1="2" y1="4" x2="27" y2="4" /></svg></dt><dd>Schematic</dd></div>
              )}
            </dl>
          )}
          {view && scale && (
            <div className="scale-row" aria-label={`Scale: ${scale.km} kilometres`}>
              <svg className="compass" width="22" height="22" viewBox="-11 -11 22 22" aria-label={`North is ${Math.round(view.northDeg)} degrees from straight up`} role="img">
                <g transform={`rotate(${view.northDeg})`}>
                  <path d="M0 -9 L3 3 L0 1 L-3 3 Z" />
                </g>
              </svg>
              <div className="scale">
                <span className="scale-bar" style={{ width: `${scale.px}px` }} />
                <span className="scale-lab">{scale.km.toLocaleString("en-GB")} km</span>
              </div>
            </div>
          )}
        </div>

        <p className="attribution" data-map-ui data-map-reserve>
          {poster && <span>Albers equal-area conic, 25°N / 47°N · </span>}
          {MAP_CONFIG.attribution.map((a, i) => (
            <span key={a.label}>{i ? " · " : ""}<a href={a.href} target="_blank" rel="noreferrer">{a.label}</a></span>
          ))}
        </p>

        {segData && seg && mapBox && !stop && (
          <div
            className={`seg-note ${pinnedSeg ? "is-pinned" : ""}`}
            data-map-ui
            role={pinnedSeg ? "dialog" : "tooltip"}
            aria-label={pinnedSeg ? "Route segment" : undefined}
            style={{
              left: Math.min(Math.max(seg.clientX - mapBox.left + 14, 12), mapBox.width - 272),
              top: Math.min(Math.max(seg.clientY - mapBox.top + 14, 12), mapBox.height - 170),
            }}
          >
            <p className="seg-route">
              {placeName(segData.from)} → {placeName(segData.to)}
              <span> · {dateRange(segData.date)}</span>
            </p>
            <ul className="legs"><LegLine seg={segData} km={lengths.get(segData.id)} /></ul>
            {segData.notes && <p className="card-note">{segData.notes}</p>}
            {pinnedSeg && (
              <button type="button" className="icon-btn card-close" onClick={() => setPinnedSeg(null)} aria-label="Close">
                <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
              </button>
            )}
          </div>
        )}

        {stop && !poster && !worldOpen && (
          <StopCard
            key={stop.id}
            stop={stop}
            lengths={lengths}
            posts={posts.filter((p) => p.stopId === stop.id)}
            visitedIdeas={new Set(posts.map((p) => p.place?.ideaId).filter((x): x is string => !!x))}
            onOpenPost={showPost}
            variant={mobile ? "sheet" : "float"}
            onClose={() => select(null, false)}
            onGo={(id) => {
              if (playing) pause();
              select(id);
            }}
          />
        )}
      </div>
    </main>
  );
}

function Welcome({ posts, onClose, onOpenJournal }: { posts: JournalEntry[]; onClose: () => void; onOpenJournal: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const latest = posts[posts.length - 1];
  return (
    <div className="post-backdrop welcome-backdrop" onClick={onClose} data-map-ui>
      <div
        ref={ref}
        className="welcome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <p className="post-kicker">10–19 October 2026 · {TRIP.totals.ridingDays} riding days · {TRIP.totals.km} km</p>
        <h2 id="welcome-title" className="welcome-title">Hello from P2N Cyclists in China! This is our cycle route through Guizhou and Guangxi.</h2>
        <p className="welcome-lede">{TRIP.strap}</p>
        <ul className="welcome-list">
          <li><b>Zoom out</b> with −, or tap the globe, for the whole world: posts from anywhere (Beijing, or home) show up there too.</li>
          <li><b>Tap a numbered stop</b> to see where we sleep each night, and that day's ride: distance, climbing and what's on the way.</li>
          <li><b>Press Play journey</b> to watch the whole route unfold, Guiyang to Yangshuo.</li>
          <li><b>Updates from the road</b> pop up here the next time you open this page. They also appear as <span className="welcome-pin" aria-hidden="true" /> pins, and the dotted line shows where we've actually been.</li>
          <li><b>The red line is the ride.</b> It follows the roads, so it's a close guide rather than the exact track. The distances and climbing come from the tour's route planner.</li>
          <li>Signal will be patchy in the mountain villages, so a quiet day or two usually just means no signal (or tired legs).</li>
        </ul>
        <section className="welcome-post" aria-labelledby="welcome-post-title">
          <h3 id="welcome-post-title">Posting to the journal (riders)</h3>
          <p>
            Email <a href={`mailto:${TRIP.journalEmail}`}>{TRIP.journalEmail}</a> from your own address. The subject is the title,
            the text is the post, and attached photos are added. It appears here within about 20 minutes. No signal? Send anyway: it goes when you're back online.
          </p>
          <p><b>Put it on the map</b> with a line in the email:</p>
          <ul className="welcome-list">
            <li><code>@ 26.0415, 108.6394</code> pins it exactly. The Compass app shows your coordinates, even with no signal.</li>
            <li><code>@ Leigong Shan</code> (any place name) finds it on the map. Tiny villages may not be found, so use coordinates for those.</li>
            <li><code>@ stop 6</code> files it under that night's stop (the numbers on the map).</li>
            <li>No tag? A photo's own location is used if it has one, otherwise the post goes under that day's stop.</li>
          </ul>
          <p className="welcome-note">Gmail doesn't work in China without a VPN or roaming eSIM. To remove a post, email the subject <code>HIDE</code> followed by its exact title.</p>
        </section>
        <p className="welcome-status">
          {latest ? (
            <>Latest post: <b>{latest.title}</b>, {timeAgo(latest.date)}. </>
          ) : (
            <>Nothing posted yet. The first update will come once we've landed in Guiyang.</>
          )}
        </p>
        <div className="welcome-actions">
          <button type="button" className="welcome-go" onClick={onClose}>Explore the map</button>
          {latest && <button type="button" className="nav-btn" onClick={onOpenJournal}>Read the journal →</button>}
        </div>
      </div>
    </div>
  );
}
