import type { IconId } from "../data/types";

/** Small line icons, 24×24, stroke = currentColor. */
const PATHS: Record<IconId, string> = {
  city: "M3 21h18M5 21V9l5-3v15M10 21V4l6 3v14M16 21v-9l3 1.5V21M7 11h1M7 14h1M12 9h2M12 12h2M12 15h2",
  basketball: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3v18M5.6 5.6c3 2.6 3 10.2 0 12.8M18.4 5.6c-3 2.6-3 10.2 0 12.8",
  river: "M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4-2 6 0M2 14c2.5-2 4.5-2 7 0s4.5 2 7 0 4-2 6 0M4 19h16M7 19v-3M17 19v-3M7 16c3-3 7-3 10 0",
  peak: "M2 20l7-12 4 6 3-4 6 10zM9 8l1.6 3.2L12 10",
  valley: "M2 5l5 8 2-2 3 9 3-9 2 2 5-8M10 20h4",
  teahouse: "M4 10h12v4a6 6 0 0 1-12 0zM16 11h2a2 2 0 0 1 0 4h-2.4M3 21h15M8 3c-1 1.3 1 2.2 0 3.5M12 3c-1 1.3 1 2.2 0 3.5",
  train: "M6 3h12a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM4 11h16M8 14.5h.01M16 14.5h.01M7 21l2-3M17 21l-2-3M9 3v8M15 3v8",
  market: "M3 9l2-5h14l2 5M3 9h18M3 9a3 3 0 0 0 6 0a3 3 0 0 0 6 0a3 3 0 0 0 6 0M5 12v9h14v-9M10 21v-5h4v5",
  oasis: "M12 21V10M12 10c-2-3-6-3-8-1M12 10c2-3 6-3 8-1M12 10c-1-3-4-5-7-5M12 10c1-3 4-5 7-5M3 21c3-2 15-2 18 0",
  dune: "M2 18c4-6 8-8 11-8s6 3 9 8zM2 21h20M9 11c1.5 2 1.5 5 0 7",
  danxia: "M2 20c3-6 6-9 9-9s7 3 11 9M4 17c3-3 5-4 7-4s5 1 9 4M6.5 14c2-1.6 3.4-2 4.5-2s3 .4 5.5 2M2 20h20",
  gate: "M3 21V10h18v11M3 10l2-4h14l2 4M6 6l1-3h10l1 3M10 21v-5a2 2 0 0 1 4 0v5M6 13h2M16 13h2",
  terraces: "M2 20c4-1 8-1 10-3s6-2 10-2M2 16c4-1 7-1 9-3s6-2 11-2M2 12c3-1 6-1 8-3s6-2 12-2M2 8c3-1 5-1 7-3s5-2 7-2",
  drum: "M12 2l-5 4h10zM12 6l-6 4h12zM12 10l-7 4h14zM8 14v7M16 14v7M4 21h16M10.5 21v-3h3v3",
  karst: "M2 21c1-9 3-13 5-13s2 6 3 6 1-11 4-11 3 8 4 8 2-2 2 1 1 6 1 9M2 21h20",
  bike: "M2 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M15 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M5.5 17.5L9 10h7l2.5 7.5M9 10l3.5 7.5L16 10M8 7h3M15 7h2l1 3",
  plane: "M10.5 3.5a1.5 1.5 0 0 1 3 0V9l7 4v2l-7-2v5l2 1.5V21l-3.5-1-3.5 1v-1.5l2-1.5v-5l-7 2v-2l7-4z",
};

export function Icon({ id, size = 20, title }: { id: IconId; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={PATHS[id]} />
    </svg>
  );
}
