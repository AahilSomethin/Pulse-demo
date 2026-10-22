import { describe, expect, it } from "vitest";

import { buildGuideSteps, type GuideSnapshot } from "@/tour/steps";

const loaded: GuideSnapshot = {
  datasetLoaded: true,
  synthetic: false,
  periodLabel: "1 August 2025",
  deviceCount: 12,
  connectionCount: 4,
  opportunityCount: 1,
  monthLoaded: false,
  censusMatched: 10,
  censusAmbiguous: 2,
  censusUnmatched: 3,
  exampleLabel: "Kulhudhuffushi to Naifaru",
};

describe("team guide steps", () => {
  it("keeps the nine-step order and centred fallbacks when nothing is loaded", () => {
    const steps = buildGuideSteps();
    expect(steps.map((step) => step.id)).toEqual([
      "why",
      "data",
      "explore",
      "playback",
      "network",
      "profile",
      "opportunities",
      "routes",
      "limits",
    ]);
    expect(steps.find((step) => step.id === "why")?.target).toBeNull();
    expect(steps.find((step) => step.id === "playback")?.target).toBeNull();
    expect(steps.find((step) => step.id === "profile")?.target).toBeNull();
    expect(steps.find((step) => step.id === "profile")?.openConnection).toBe(false);
    const text = steps.map((step) => `${step.description} ${step.fallbackDescription}`).join(" ");
    expect(text).not.toContain("12");
    expect(text).not.toContain("Kulhudhuffushi");
    expect(text).toContain("nothing to flag");
    expect(text).toContain("not a live vessel feed");
  });

  it("uses only the counts in the snapshot", () => {
    const steps = buildGuideSteps(loaded);
    const data = steps.find((step) => step.id === "data");
    const profile = steps.find((step) => step.id === "profile");
    const opportunities = steps.find((step) => step.id === "opportunities");
    expect(data?.description).toContain("12");
    expect(data?.description).toContain("10");
    expect(data?.description).toContain("2");
    expect(data?.description).toContain("3");
    expect(profile?.target).toBe("details");
    expect(profile?.description).toContain("Kulhudhuffushi to Naifaru");
    expect(opportunities?.description).toContain("4");
    expect(opportunities?.description).toContain("1");
    expect(opportunities?.description).toContain("not proof");
    expect(steps.find((step) => step.id === "playback")?.target).toBe("playback");
    expect(steps.find((step) => step.id === "limits")?.target).toBe("nav-experimental");
    expect(steps.find((step) => step.id === "limits")?.description).toContain("Emergency Simulation");
    expect(steps.find((step) => step.id === "limits")?.description).toContain("Experimental");
  });

  it("labels a synthetic example instead of a real service", () => {
    const steps = buildGuideSteps({ ...loaded, synthetic: true, exampleLabel: "North to South" });
    expect(steps.find((step) => step.id === "profile")?.description).toContain("synthetic test data");
    expect(steps.find((step) => step.id === "data")?.description).toContain("synthetic test data");
  });
});
