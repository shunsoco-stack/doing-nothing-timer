import type { NextConfig } from "next";
import { resolve } from "node:path";

const isDevelopment = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com https://adm.shinobi.jp https://*.shinobi.jp https://*.cnobi.jp${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.shinobi.jp https://*.cnobi.jp",
  "font-src 'self'",
  `connect-src 'self' https://vitals.vercel-insights.com https://*.shinobi.jp https://*.cnobi.jp${isDevelopment ? " ws: wss:" : ""}`,
  "frame-src https://*.shinobi.jp https://*.cnobi.jp",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// The intro guide keeps a looser policy because it is a static document.
// The Service Worker CSP stays unchanged.
const introductionContentSecurityPolicy = [
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // This application is independent, even when checked out inside another repo.
  turbopack: { root: resolve(__dirname) },
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), web-share=(self)",
          },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; script-src 'self'; connect-src 'self'",
          },
        ],
      },
      {
        source: "/about.html",
        headers: [
          {
            key: "Content-Security-Policy",
            value: introductionContentSecurityPolicy,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
