import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@promptkiddie/core"],
  serverExternalPackages: ["pg"],
};

export default config;
