import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright resolves its browser binaries and driver relative to its own
  // install location, and @sparticuz/chromium ships its browser as compressed
  // files beside its code that it unpacks at run time. Bundling either into
  // the server build breaks that lookup; firebase-admin is kept external for
  // its gRPC dependencies.
  serverExternalPackages: ["playwright", "@sparticuz/chromium", "firebase-admin"],

  // The traced server output has to carry @sparticuz/chromium's binaries: the
  // tracer follows imports, and the .br files are read from disk, never
  // imported, so without this they are left out and the browser fallback
  // cannot start on App Hosting.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
