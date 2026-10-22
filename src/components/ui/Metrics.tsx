import type { ReactNode } from "react";

export function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <article className="rounded-lg border border-border bg-surface px-3 py-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {detail ? <p className="mt-1 text-xs text-fg-secondary">{detail}</p> : null}
    </article>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  const toneClass = tone === "warning" ? "border-warning bg-warning-soft text-fg" : "border-border bg-surface-sunken text-fg-secondary";
  return <p className={`rounded-lg border px-3 py-2 text-sm ${toneClass}`}>{children}</p>;
}

export function PageHeader({ title, lede }: { title: string; lede: string }) {
  return (
    <header>
      <p className="text-xs font-medium tracking-wide text-ocean">Maritime intelligence</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm leading-6 text-fg-secondary">{lede}</p>
    </header>
  );
}

export const asideClass =
  "scroll-thin flex max-h-[min(42dvh,100%)] min-h-0 shrink-0 flex-col gap-3 overflow-y-auto border-b border-border p-3 lg:max-h-none lg:w-[22rem] lg:border-r lg:border-b-0 xl:w-96";

export function MapLegend({ items }: { items: { swatch: string; label: string }[] }) {
  return (
    <ul className="pointer-events-none absolute bottom-10 left-14 z-10 max-w-[16rem] rounded-lg border border-border bg-overlay px-3 py-2 text-xs leading-5 text-fg-secondary">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${item.swatch}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function MapStatus({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-overlay p-6 text-center text-sm" role="status">
      {label}
    </div>
  );
}

export function EmptyState({ title, children, heading = "h1" }: { title: string; children: ReactNode; heading?: "h1" | "h2" }) {
  const Title = heading;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 px-6 py-16 text-center">
      <Title className="text-2xl font-semibold tracking-tight">{title}</Title>
      <div className="text-sm leading-6 text-fg-secondary">{children}</div>
    </div>
  );
}
