import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: {
    position: "bottom-right",
  },
  experimental: {
    agentFeedback: true,
    // Next 16.4's automatic instant-UI validator fails on Auth's lazy client
    // provider in development. Keep caching/prefetching, but validate only
    // routes that explicitly opt in until that framework issue is resolved.
    instantInsights: {
      validationLevel: "manual-warning",
    },
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
