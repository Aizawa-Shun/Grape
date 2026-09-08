import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @libsql/client resolves a platform-specific native binding at require time,
  // and playwright resolves its browser binaries and driver relative to its own
  // install location. Bundling either into the server build breaks that lookup.
  serverExternalPackages: ["@libsql/client", "libsql", "playwright"],
};

export default nextConfig;
