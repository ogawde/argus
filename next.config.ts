import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents / partialPrefetching from create-next-app conflict with
  // route segment configs and dynamic(..., { ssr: false }). Revisit later.
  agentRules: false,
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "@prisma/client",
    "prisma",
  ],
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
