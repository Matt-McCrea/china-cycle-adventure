#!/bin/bash
# Downloads the OSM railway line relations listed in app/src/data/itinerary.ts (LINES)
# into scripts/.cache/rail/<id>.osm, using the main OSM API (/relation/<id>/full).
# Usage: scripts/fetch-rail.sh 163418 163712 ...   (skips files already present)
cd "$(dirname "$0")" && mkdir -p .cache/rail
for id in "$@"; do
  [ -s ".cache/rail/$id.osm" ] && continue
  curl -s -m 280 -A "ChinaAdventureMap/1.0 (personal trip map)" \
    "https://api.openstreetmap.org/api/0.6/relation/$id/full" -o ".cache/rail/$id.osm"
  echo "$id $(wc -c < .cache/rail/$id.osm) bytes"
done
