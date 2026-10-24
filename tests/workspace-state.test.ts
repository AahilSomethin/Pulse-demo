import { describe, expect, it } from "vitest";

import { initialWorkspaceState, reduceWorkspace } from "@/lib/workspace/state";

describe("workspace state", () => {
  it("closes the details drawer without clearing the selected feature", () => {
    const open = reduceWorkspace(initialWorkspaceState(), { type: "open-detail", detail: { type: "vessel", device: 4 } });
    const closed = reduceWorkspace(open, { type: "close-detail" });
    expect(closed.detailsOpen).toBe(false);
    expect(closed.detail).toEqual({ type: "vessel", device: 4 });
    expect(reduceWorkspace(closed, { type: "reopen-detail" }).detailsOpen).toBe(true);
  });

  it("keeps filters while the sidebar is hidden and restores them", () => {
    const hidden = reduceWorkspace(initialWorkspaceState(), { type: "sidebar", mode: "hidden" });
    const toggled = reduceWorkspace(hidden, { type: "toggle-layer", layer: "hubs" });
    expect(toggled.sidebar).toBe("hidden");
    expect(toggled.layers.hubs).toBe(false);
    expect(toggled.layers.vessels).toBe(true);
    expect(reduceWorkspace(toggled, { type: "sidebar", mode: "expanded" }).layers.hubs).toBe(false);
  });

  it("leaves the snapshot unchanged when the network tab is already selected", () => {
    const routes = reduceWorkspace(initialWorkspaceState(), { type: "network-tab", tab: "routes" });
    expect(reduceWorkspace(routes, { type: "network-tab", tab: "routes" })).toBe(routes);
  });

  it("keeps one demo consent per boat, route, and incident", () => {
    const selected = reduceWorkspace(initialWorkspaceState(), { type: "boat-device", device: 3, source: "day-1" });
    const consent = {
      device: 3,
      routeKey: "3:1:2",
      incidentKey: "4.00000,73.00000",
      routeLabel: "North to South",
      choice: "offer" as const,
    };
    const offered = reduceWorkspace(selected, { type: "rescue-consent", consent });
    const declined = reduceWorkspace(offered, { type: "rescue-consent", consent: { ...consent, choice: "decline" } });
    expect(declined.boatDevice).toBe(3);
    expect(declined.consents).toEqual([{ ...consent, choice: "decline" }]);
    expect(reduceWorkspace(declined, { type: "rescue-consent", consent: declined.consents[0] })).toBe(declined);
    expect(reduceWorkspace(declined, { type: "reset-boat" }).consents).toEqual([]);
  });

  it("hydrates only the stored preferences", () => {
    const next = reduceWorkspace(initialWorkspaceState(), {
      type: "hydrate",
      sidebar: "collapsed",
      clock: "mvt",
      layers: { trail: false },
    });
    expect(next.sidebar).toBe("collapsed");
    expect(next.clock).toBe("mvt");
    expect(next.layers.trail).toBe(false);
    expect(next.layers.hubs).toBe(true);
    expect(next.presenting).toBe(false);
  });
});
