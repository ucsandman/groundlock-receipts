import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  typedRoutes: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
  transpilePackages: ["@groundlock/core"],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack(config: any, { isServer }: { isServer: boolean }) {
    if (!isServer) {
      // node:crypto is used only in server-side core paths.
      // Client components never execute crypto-backed receipt signing or verification.
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
