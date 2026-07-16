import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@promptkiddie/core"],
  serverExternalPackages: ["pg", "@huggingface/transformers", "onnxruntime-node"],
};

export default config;
