import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BASEMAP_PALETTE, MAP_COLORS } from "@/config/map-colors";

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const left = luminance(a);
  const right = luminance(b);
  const [hi, lo] = left > right ? [left, right] : [right, left];
  return (hi + 0.05) / (lo + 0.05);
}

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(start, css.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tokens[match[1]] = match[2].trim();
  return tokens;
}

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const dark = block(css, ":root {");
const light = block(css, '[data-theme="light"]');

describe("interface contrast", () => {
  for (const [name, tokens] of [["dark", dark], ["light", light]] as const) {
    it(`${name} text and controls clear WCAG AA on their surfaces`, () => {
      const pairs: [string, string][] = [
        ["--fg", "--surface"],
        ["--fg", "--background"],
        ["--fg-secondary", "--surface"],
        ["--fg-muted", "--surface"],
        ["--fg-muted", "--surface-sunken"],
        ["--primary-fg", "--primary"],
        ["--primary", "--surface"],
        ["--ocean", "--surface"],
        ["--cyan", "--surface"],
        ["--selected", "--surface"],
        ["--warning", "--surface"],
        ["--danger", "--surface"],
      ];
      for (const [ink, paper] of pairs) {
        expect(contrast(tokens[ink], tokens[paper]), `${ink} on ${paper}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

function same(map: string, token: string | undefined): void {
  expect(map.toLowerCase()).toBe(token?.toLowerCase());
}

describe("basemap separation", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} land, sea, urban, and roads are not the same luminance`, () => {
      const palette = BASEMAP_PALETTE[theme];
      expect(contrast(palette.land, palette.sea)).toBeGreaterThanOrEqual(1.8);
      expect(contrast(palette.urban, palette.land)).toBeGreaterThanOrEqual(1.4);
      expect(contrast(palette.road, palette.land)).toBeGreaterThanOrEqual(1.8);
      expect(contrast(palette.roadCase, palette.sea)).toBeGreaterThanOrEqual(2);
      expect(contrast(palette.roadCase, palette.road)).toBeGreaterThanOrEqual(1.4);
      expect(palette.land).not.toBe(palette.sea);
      expect(palette.urban).not.toBe(palette.land);
    });
  }

  it("keeps map roles aligned with the interface tokens", () => {
    same(MAP_COLORS.light.vessel, light["--vessel"]);
    same(MAP_COLORS.dark.vessel, dark["--vessel"]);
    same(MAP_COLORS.light.trail, light["--ocean"]);
    same(MAP_COLORS.dark.trail, dark["--ocean"]);
    same(MAP_COLORS.light.inferred, light["--cyan"]);
    same(MAP_COLORS.dark.inferred, dark["--cyan"]);
    same(MAP_COLORS.light.selected, light["--selected"]);
    same(MAP_COLORS.dark.selected, dark["--selected"]);
    same(MAP_COLORS.light.incident, light["--danger"]);
    same(MAP_COLORS.dark.incident, dark["--danger"]);
    same(MAP_COLORS.light.hypothetical, light["--warning"]);
    same(MAP_COLORS.dark.hypothetical, dark["--warning"]);
    same(MAP_COLORS.light.hubLine, light["--hub"]);
    same(MAP_COLORS.dark.hubLine, dark["--hub"]);
  });
});
