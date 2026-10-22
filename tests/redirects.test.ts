import { describe, expect, it } from "vitest";

import { COMPAT_REDIRECTS } from "@/config/redirects";

describe("compatibility redirects", () => {
  it("keeps the old pages on the three sections", () => {
    expect(COMPAT_REDIRECTS).toEqual([
      { source: "/", destination: "/explore", permanent: false },
      { source: "/explorer", destination: "/explore", permanent: false },
      { source: "/emergency", destination: "/simulate", permanent: false },
      { source: "/routes", destination: "/network?tab=routes", permanent: false },
    ]);
    expect(COMPAT_REDIRECTS.every((redirect) => redirect.permanent === false)).toBe(true);
  });
});
