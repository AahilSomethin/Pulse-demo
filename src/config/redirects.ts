/** Old routes stay reachable. Temporary so a later rename is not cached forever. */
export const COMPAT_REDIRECTS = [
  { source: "/", destination: "/explore", permanent: false },
  { source: "/explorer", destination: "/explore", permanent: false },
  { source: "/emergency", destination: "/simulate", permanent: false },
  { source: "/routes", destination: "/network?tab=routes", permanent: false },
] as const;
