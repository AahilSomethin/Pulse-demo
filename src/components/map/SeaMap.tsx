"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type SeaMapInner from "@/components/map/SeaMapInner";

export type { MapClickMode, MapLine, MapMarker } from "@/types/map";

const Inner = dynamic(() => import("@/components/map/SeaMapInner"), {
  ssr: false,
  loading: () => <div className="grid h-full min-h-[16rem] place-items-center text-sm text-fg-muted">Loading map…</div>,
});

export function SeaMap(props: ComponentProps<typeof SeaMapInner>) {
  return <Inner {...props} />;
}
