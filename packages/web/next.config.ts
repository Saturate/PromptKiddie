import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@promptkiddie/core"],
  serverExternalPackages: ["pg"],
  typescript: { ignoreBuildErrors: true },
};

export default config;
