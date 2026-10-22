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

export function MapLegend({ items }: { items: { swatch: string; label: string; pattern?: "dot" | "solid" | "dashed" }[] }) {
  return (
    <ul data-tour="map-legend" className="pointer-events-none absolute bottom-10 left-14 z-10 max-w-[16rem] rounded-lg border border-border bg-overlay px-3 py-2 text-xs leading-5 text-fg-secondary">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <LegendSwatch swatch={item.swatch} pattern={item.pattern} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function LegendSwatch({ swatch, pattern = "dot" }: { swatch: string; pattern?: "dot" | "solid" | "dashed" }) {
  if (pattern === "solid") return <span className={`h-0.5 w-4 shrink-0 rounded-full ${swatch}`} />;
  if (pattern === "dashed") return <span className={`h-0 w-4 shrink-0 border-t-2 border-dashed ${swatch.replace("bg-", "border-")}`} />;
  return <span className={`size-2 shrink-0 rounded-full ${swatch}`} />;
}

export function MapStatus({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-overlay p-6 text-center text-sm" role="status">
      {label}
    </div>
  );
}
