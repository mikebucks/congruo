import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@congruo/core",
    "@congruo/db",
    "@congruo/scoring",
    "@congruo/analyzers",
  ],
};

export default nextConfig;
