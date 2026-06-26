import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@promptkiddie/core"],
  serverExternalPackages: ["pg"],
};

export default config;
