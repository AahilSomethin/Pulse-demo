"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useDataset, usePlaybackSettings } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { boundsCenter, ringBounds, unionBounds } from "@/lib/geo/bounds";
import { ATOLL_CODES } from "@/lib/reference/atolls";
import { searchPlaces, type SearchHit } from "@/lib/search/query";

export function GlobalSearch() {
  const { dataset, geography, harbours, indicators, monthIndicators } = useDataset();
  const playback = usePlaybackSettings();
  const { state, openDetail, focusOn, setPick } = useWorkspace();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const source = state.network.scope === "month" && monthIndicators.length > 0 ? monthIndicators : indicators;
  const polygonCountByAtoll = useMemo(() => {
    const counts = new Map<string, number>();
    for (const code of ATOLL_CODES) counts.set(code, 0);
    for (const polygon of geography?.polygons ?? []) {
      if (!polygon.atoll || polygon.synthetic) continue;
      counts.set(polygon.atoll, (counts.get(polygon.atoll) ?? 0) + 1);
    }
    return counts;
  }, [geography]);
  const results = useMemo(
    () => searchPlaces(query, {
      polygons: geography?.polygons ?? [],
      harbours,
      indicators: source,
      vesselNames: dataset?.names ?? null,
      polygonCountByAtoll,
    }),
    [query, geography, harbours, source, dataset, polygonCountByAtoll],
  );
  const flat = results.groups.flatMap((group) => group.hits);
  const rows = results.groups.flatMap((group) => group.hits.map((hit, offset) => ({
    group: group.label,
    groupId: group.id,
    hit,
    index: results.groups.slice(0, results.groups.indexOf(group)).reduce((sum, item) => sum + item.hits.length, 0) + offset,
  })));

  useEffect(() => {
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, []);

  function choose(hit: SearchHit) {
    setOpen(false);
    if (hit.kind === "vessel" && hit.device != null && dataset) {
      const last = dataset.tracks[hit.device]?.at(-1);
      playback.setSelected(hit.device);
      openDetail({ type: "vessel", device: hit.device });
      setPick(null);
      if (last != null) focusOn(dataset.lon[last], dataset.lat[last], { zoom: 11 });
      return;
    }
    if (hit.kind === "island") {
      const polygon = geography?.polygons.find((item) => item.id === hit.id);
      const bounds = polygon ? ringBounds(polygon.rings) : null;
      if (hit.lon != null && hit.lat != null) focusOn(hit.lon, hit.lat, bounds ? { bounds } : { zoom: 11 });
      openDetail({ type: "location", id: hit.id });
      setPick(null);
      return;
    }
    if (hit.kind === "atoll") {
      const polygons = (geography?.polygons ?? []).filter((polygon) => polygon.atoll === hit.id && !polygon.synthetic);
      const bounds = unionBounds(polygons.map((polygon) => ringBounds(polygon.rings)));
      if (!bounds) return;
      const center = boundsCenter(bounds);
      focusOn(center.lon, center.lat, { bounds });
      setPick(null);
      return;
    }
    if (hit.kind === "area" && hit.lon != null && hit.lat != null) {
      focusOn(hit.lon, hit.lat, { zoom: 11 });
      openDetail({ type: "location", id: hit.id });
      setPick(null);
      return;
    }
    if (hit.kind === "harbour" && hit.lon != null && hit.lat != null) {
      focusOn(hit.lon, hit.lat, { zoom: 13 });
      setPick({ lon: hit.lon, lat: hit.lat, label: `${hit.title} · OpenStreetMap reference, not a verified port call` });
    }
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(flat.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && flat[active]) {
      event.preventDefault();
      choose(flat[active]);
    }
  }

  return (
    <div ref={root} className="relative min-w-0 flex-1 basis-full sm:basis-64 sm:max-w-sm">
      <label className="sr-only" htmlFor="global-search">Search islands, atolls, harbours, and vessels</label>
      <input
        id="global-search"
        data-tour="global-search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="w-full min-w-0 rounded-md border border-border bg-surface-sunken px-3 py-1.5 text-sm"
        placeholder="Search islands, atolls, harbours"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && query.trim().length >= 2 ? (
        <div id={listId} role="listbox" className="absolute top-full z-50 mt-1 max-h-[70dvh] w-full min-w-64 overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-panel">
          {results.groups.length === 0 ? <p className="px-2 py-1 text-sm text-fg-muted">No matches.</p> : null}
          {results.groups.map((group) => (
            <section key={group.id} className="mb-2 last:mb-0">
              <h2 className="px-2 py-1 text-xs font-medium text-fg-muted">{group.label}</h2>
              <ul>
                {rows.filter((row) => row.groupId === group.id).map((row) => (
                  <li key={`${row.hit.kind}:${row.hit.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={row.index === active}
                      className={`w-full rounded-md px-2 py-1.5 text-left ${row.index === active ? "bg-surface-hover" : "hover:bg-surface-hover"}`}
                      onMouseEnter={() => setActive(row.index)}
                      onClick={() => choose(row.hit)}
                    >
                      <span className="block text-sm">{row.hit.title}</span>
                      <span className={`block text-xs leading-5 ${row.hit.ambiguous ? "text-warning" : "text-fg-muted"}`}>{row.hit.subtitle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {results.notes.map((note) => <p key={note} className="px-2 py-1 text-xs leading-5 text-fg-muted">{note}</p>)}
        </div>
      ) : null}
    </div>
  );
}
