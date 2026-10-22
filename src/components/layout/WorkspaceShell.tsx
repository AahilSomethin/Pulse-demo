"use client";

import { Anchor, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { DetailsDrawer } from "@/components/layout/DetailsDrawer";
import { MapStage } from "@/components/layout/MapStage";
import { Sidebar } from "@/components/layout/Sidebar";
import { PlaybackBar } from "@/components/vessels/PlaybackBar";
import { useDataset, usePlaybackSettings } from "@/context/MaritimeContext";
import { useTheme } from "@/context/ThemeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { historicalLabel } from "@/lib/format";
import { PLAYBACK_SPEEDS } from "@/lib/vessels/playback";

const SECTIONS = [
  { href: "/explore", label: "Explore" },
  { href: "/network", label: "Network" },
  { href: "/simulate", label: "Simulate" },
];

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { dataset, loading } = useDataset();
  const { playing, setPlaying, speed, setSpeed } = usePlaybackSettings();
  const { state, setPresenting, closeDetail } = useWorkspace();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target != null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (event.key === "Escape") {
        if (state.presenting) {
          setPresenting(false);
          return;
        }
        if (state.detailsOpen) closeDetail();
        return;
      }
      if (typing || target?.tagName === "BUTTON" || target?.tagName === "A") return;
      if (event.key === " ") {
        event.preventDefault();
        setPlaying(!playing);
      } else if (event.key === "p" || event.key === "P") {
        setPresenting(!state.presenting);
      } else if (event.key === "[" || event.key === "]") {
        const index = PLAYBACK_SPEEDS.indexOf(speed);
        const next = index + (event.key === "]" ? 1 : -1);
        if (next >= 0 && next < PLAYBACK_SPEEDS.length) setSpeed(PLAYBACK_SPEEDS[next]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDetail, playing, setPlaying, setPresenting, setSpeed, speed, state.detailsOpen, state.presenting]);

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {state.presenting ? null : (
        <header className="z-40 flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-3 py-2 sm:px-4">
          <Link href="/explore" className="flex items-center gap-2 font-semibold tracking-tight">
            <Anchor className="text-primary" size={18} aria-hidden />
            SeaPulse
          </Link>
          <nav aria-label="Primary" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {SECTIONS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm ${active ? "bg-primary-soft text-primary" : "text-fg-secondary hover:bg-surface-hover"}`}
                >
                  {item.label}
                  {item.href === "/simulate" ? <span className="ml-1 text-xs text-fg-muted">Experimental</span> : null}
                </Link>
              );
            })}
          </nav>
          <p className="hidden min-w-0 truncate text-xs text-fg-muted xl:block">
            {loading ? "Reading tracker file…" : dataset ? `${historicalLabel(dataset.periodLabel)} · ${dataset.names.length} devices · ${dataset.sourceLabel}` : "No dataset loaded"}
            {dataset?.synthetic ? " · synthetic test data" : ""}
          </p>
          <button type="button" className="btn" aria-pressed={state.presenting} onClick={() => setPresenting(true)}>
            Presentation view
          </button>
          <button type="button" className="btn btn-ghost" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
            {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
          </button>
        </header>
      )}
      <div id="content" className="relative flex min-h-0 flex-1">
        {state.presenting ? <div className="hidden">{children}</div> : <Sidebar>{children}</Sidebar>}
        <div className="relative min-h-0 min-w-0 flex-1">
          <MapStage />
          {state.presenting ? <PresentSwitch /> : null}
          <DetailsDrawer />
        </div>
      </div>
      <PlaybackBar />
    </div>
  );
}

function PresentSwitch() {
  const pathname = usePathname();
  const { setPresenting } = useWorkspace();
  return (
    <div className="absolute top-3 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-panel">
      {SECTIONS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`btn ${active ? "btn-primary" : "btn-ghost"}`}>
            {item.label}
          </Link>
        );
      })}
      <button type="button" className="btn btn-ghost" onClick={() => setPresenting(false)}>
        Exit
      </button>
    </div>
  );
}
