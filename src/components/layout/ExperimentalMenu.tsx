"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

const MENU = [
  { href: "/simulate", title: "Emergency Simulation", detail: "Hypothetical times from historical positions" },
  { href: "/boat", title: "Boat operator", detail: "One device's recorded routes and a demo consent" },
] as const;

/** Secondary navigation for features that are not part of the Explore → Network path. */
export function ExperimentalMenu({ variant }: { variant: "nav" | "present" }) {
  const pathname = usePathname();
  const active = pathname === "/simulate" || pathname === "/boat";
  const [open, setOpen] = useState(false);
  const [openPath, setOpenPath] = useState(pathname);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLAnchorElement>(null);
  const focusItem = useRef(false);
  const menuId = useId();

  if (pathname !== openPath) {
    setOpenPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open || !focusItem.current) return;
    focusItem.current = false;
    itemRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function toggle() {
    setOpen((current) => !current);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (open) {
        const nodes = rootRef.current?.querySelectorAll<HTMLAnchorElement>("[role='menuitem']");
        if (!nodes?.length) return;
        const list = [...nodes];
        const index = list.findIndex((node) => node === document.activeElement);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = index < 0 ? 0 : (index + delta + list.length) % list.length;
        list[next]?.focus();
        return;
      }
      focusItem.current = true;
      setOpen(true);
    }
  }

  const selected = active || open;
  const buttonClass = variant === "nav"
    ? `inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-sm ${selected ? "bg-primary-soft text-primary" : "text-fg-secondary hover:bg-surface-hover"}`
    : `btn ${selected ? "border-primary bg-primary-soft text-primary" : "btn-ghost"}`;

  return (
    <div ref={rootRef} className="relative shrink-0" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={active ? "page" : undefined}
        data-tour={variant === "nav" ? "nav-experimental" : undefined}
        onClick={toggle}
      >
        Experimental
        <ChevronDown size={14} aria-hidden className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Experimental"
          className={`absolute top-full z-50 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-surface p-1 shadow-panel ${variant === "present" ? "right-0" : "left-0"}`}
        >
          {MENU.map((item, index) => {
            const current = pathname === item.href;
            return (
              <Link
                key={item.href}
                ref={index === 0 ? itemRef : undefined}
                role="menuitem"
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`block rounded-md px-2.5 py-2 text-left text-sm ${current ? "bg-primary-soft text-primary" : "text-fg hover:bg-surface-hover"}`}
                onClick={() => setOpen(false)}
              >
                {item.title}
                <span className="mt-0.5 block text-xs font-normal text-fg-muted">{item.detail}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
