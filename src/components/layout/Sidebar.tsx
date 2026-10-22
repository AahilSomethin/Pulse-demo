"use client";

import { Compass, LifeBuoy, PanelLeftClose, PanelLeftOpen, Waypoints, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useWorkspace } from "@/context/WorkspaceContext";

const SECTIONS = [
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/network", label: "Network", icon: Waypoints },
  { href: "/simulate", label: "Simulate", icon: LifeBuoy },
] as const;

export function Sidebar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state, setSidebar } = useWorkspace();
  const expanded = state.sidebar === "expanded";
  const collapsed = state.sidebar === "collapsed";
  const width = state.sidebar === "hidden" ? "lg:w-0 lg:overflow-hidden lg:border-r-0" : collapsed ? "lg:w-14" : "lg:w-[22rem]";
  const height = state.sidebar === "hidden" ? "max-lg:h-0 max-lg:overflow-hidden" : collapsed ? "max-lg:h-14" : "max-lg:h-[min(62dvh,36rem)]";

  return (
    <aside
      id="controls"
      aria-label="Section controls"
      aria-hidden={state.sidebar === "hidden"}
      className={`absolute inset-x-0 bottom-0 z-30 flex min-h-0 flex-col border-border bg-surface transition-[width,height] duration-200 motion-reduce:transition-none max-lg:border-t lg:static lg:inset-auto lg:shrink-0 lg:border-t-0 lg:border-r ${width} ${height}`}
    >
      {collapsed ? (
        <div className="flex h-full shrink-0 items-center gap-1 px-1 lg:flex-col lg:items-stretch lg:py-2">
          <button type="button" className="btn btn-ghost" aria-label="Expand panel" onClick={() => setSidebar("expanded")}>
            <PanelLeftOpen size={16} aria-hidden />
          </button>
          <nav aria-label="Sections" className="flex min-w-0 flex-1 gap-1 overflow-x-auto lg:flex-col">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const active = pathname === section.href;
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={section.label}
                  title={section.href === "/simulate" ? "Simulate, experimental" : section.label}
                  className={`btn btn-ghost ${active ? "bg-primary-soft text-primary" : ""}`}
                  onClick={() => setSidebar("expanded")}
                >
                  <Icon size={16} aria-hidden />
                  {expanded ? null : section.href === "/simulate" ? <span className="sr-only">Experimental</span> : null}
                </Link>
              );
            })}
          </nav>
          <button type="button" className="btn btn-ghost" aria-label="Hide panel" onClick={() => setSidebar("hidden")}>
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : null}
      {expanded ? (
        <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border-soft px-2 py-1">
          <button type="button" className="btn btn-ghost" aria-label="Collapse panel" onClick={() => setSidebar("collapsed")}>
            <PanelLeftClose size={16} aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost" aria-label="Hide panel" onClick={() => setSidebar("hidden")}>
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : null}
      <div className={expanded ? "scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" : "hidden"}>{children}</div>
    </aside>
  );
}
