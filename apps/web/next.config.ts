import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@congruo/core",
    "@congruo/db",
    "@congruo/scoring",
    "@congruo/analyzers",
  ],
  async headers() {
    return [
      {
        source: "/share/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
