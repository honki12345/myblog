import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
  async headers() {
    const noindex = "noindex, nofollow, noarchive";
    return [
      {
        source: "/guestbook/:path*",
        headers: [{ key: "X-Robots-Tag", value: noindex }],
      },
      {
        source: "/api/guestbook/:path*",
        headers: [{ key: "X-Robots-Tag", value: noindex }],
      },
      {
        source: "/admin/guestbook/:path*",
        headers: [{ key: "X-Robots-Tag", value: noindex }],
      },
      {
        source: "/api/admin/guestbook/:path*",
        headers: [{ key: "X-Robots-Tag", value: noindex }],
      },
    ];
  },
};

export default nextConfig;
