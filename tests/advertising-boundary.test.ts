// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { ADMAX_TAG_ID, ADMAX_ASYNC_SDK_SRC } from "../src/components/ninja-admax-slot";

const root = resolve(import.meta.dirname, "..");
const APPROVED_TAG_ID = "6ac71f9fa046b36a907ef243676f20c9";
const RETIRED_TAG_ID = "381710d9f790ddff815d822fe92bd8af";

describe("advertising document boundary", () => {
  it("keeps the shared layout free of advertising loaders", () => {
    const source = readFileSync(resolve(root, "src/app/layout.tsx"), "utf8");
    expect(source).not.toMatch(/adm\.shinobi\.jp|admax-ads|admaxads/);
  });

  it("places one approved async banner on the production top page", () => {
    expect(ADMAX_TAG_ID).toBe(APPROVED_TAG_ID);
    expect(ADMAX_ASYNC_SDK_SRC).toBe("https://adm.shinobi.jp/st/t.js");
    const source = readFileSync(resolve(root, "src/components/ninja-admax-slot.tsx"), "utf8");
    expect(source).toContain(APPROVED_TAG_ID);
    expect(source).not.toContain(RETIRED_TAG_ID);
    expect(source).toContain("admax-ads");
    expect(source).toContain('type: "banner"');
    expect(source).not.toMatch(/document\.write/);
    expect(source).not.toMatch(/<iframe/);
    const app = readFileSync(resolve(root, "src/components/nothing-app.tsx"), "utf8");
    expect(app).toContain("NinjaAdMaxSlot");
    expect(app).not.toContain(RETIRED_TAG_ID);
  });

  it("removes the retired introduction-page tag", () => {
    const template = document.createElement("template");
    template.innerHTML = readFileSync(resolve(root, "public/about.html"), "utf8");
    const guide = template.content;
    expect(guide.querySelectorAll(".admax-ads")).toHaveLength(0);
    expect(guide.querySelectorAll('script[src="https://adm.shinobi.jp/st/t.js"]')).toHaveLength(0);
    const html = readFileSync(resolve(root, "public/about.html"), "utf8");
    expect(html).not.toContain(RETIRED_TAG_ID);
    expect(guide.querySelectorAll('a[href="/"]').length).toBeGreaterThan(0);
    expect(guide.querySelectorAll("iframe, form")).toHaveLength(0);
    expect(guide.querySelector('meta[http-equiv="Content-Security-Policy"]')).toBeNull();
  });

  it("allows AdMax on the timer document and keeps the worker CSP unchanged", async () => {
    const headers = await nextConfig.headers?.();
    if (!headers) throw new Error("Expected response header rules");
    const timer = headers.find((rule) => rule.source === "/:path*");
    const worker = headers.find((rule) => rule.source === "/sw.js");
    const guide = headers.find((rule) => rule.source === "/about.html");
    const timerCsp = timer?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    const workerCsp = worker?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    const guideCsp = guide?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    expect(timerCsp).toContain("default-src 'self'");
    expect(timerCsp).toContain("https://adm.shinobi.jp");
    expect(timerCsp).toContain("https://*.shinobi.jp");
    expect(timerCsp).toContain("https://*.cnobi.jp");
    expect(timerCsp).toContain("connect-src 'self' https://vitals.vercel-insights.com");
    expect(timerCsp).not.toContain("sandbox");
    expect(workerCsp).toBe("default-src 'none'; script-src 'self'; connect-src 'self'");
    expect(guideCsp).not.toMatch(/sandbox|(?:default|script|connect|frame|img)-src/);
    expect(guideCsp).toContain("object-src 'none'");
    expect(guideCsp).toContain("base-uri 'self'");
    expect(guideCsp).toContain("form-action 'none'");
    expect(guideCsp).toContain("frame-ancestors 'none'");
    expect(headers.filter((rule) => rule.headers.some((header) => header.key === "Content-Security-Policy"))
      .map((rule) => rule.source)).toEqual(["/:path*", "/sw.js", "/about.html"]);
    expect(headers.indexOf(guide!)).toBeGreaterThan(headers.indexOf(timer!));
  });
});
