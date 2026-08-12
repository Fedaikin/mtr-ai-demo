import type { NextConfig } from "next";

export function resolveOutputMode(isVercel: boolean): "standalone" | undefined {
  return isVercel ? undefined : "standalone";
}

const nextConfig: NextConfig = {
  // Vercel produces its own serverless build output. Standalone is retained
  // for the Docker/on-premise target where the generated server is required.
  output: resolveOutputMode(Boolean(process.env.VERCEL)),
  experimental: {
    taint: true,
  },
  serverExternalPackages: ["@electric-sql/pglite", "xlsx"],
  outputFileTracingIncludes: {
    "/*": [
      "./drizzle/**/*",
      "./node_modules/@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff",
      "./node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
