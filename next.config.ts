import type { NextConfig } from "next";

import { COMPAT_REDIRECTS } from "./src/config/redirects";

const nextConfig: NextConfig = {
  async redirects() {
    return COMPAT_REDIRECTS.map((redirect) => ({ ...redirect }));
  },
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
