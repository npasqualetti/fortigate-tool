import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/*": ["node_modules/better-sqlite3/build/Release/better_sqlite3.node"]
  }
};

export default nextConfig;
