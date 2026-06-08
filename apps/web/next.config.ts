import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  transpilePackages: ["@groundlock/core"],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack(config: any, { isServer }: { isServer: boolean }) {
    if (!isServer) {
      // node:crypto is used only for Ed25519 signing (server-side).
      // The client (page.tsx) only uses canonicalizeJson which has no crypto calls.
      // Replace node:crypto with an empty module on the browser bundle.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NormalModuleReplacementPlugin } = require("webpack");
      const stubPath = path.resolve(__dirname, "__stubs__/node-crypto.js");
      config.plugins = [
        ...(config.plugins ?? []),
        new NormalModuleReplacementPlugin(/^node:crypto$/, stubPath),
      ];
    }
    return config;
  },
};

export default nextConfig;
