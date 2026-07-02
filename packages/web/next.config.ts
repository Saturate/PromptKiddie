import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@promptkiddie/core"],
  serverExternalPackages: ["pg", "@huggingface/transformers", "onnxruntime-node"],
  typescript: { ignoreBuildErrors: true },
};

export default config;
