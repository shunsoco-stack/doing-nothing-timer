// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const root = resolve(import.meta.dirname, "..");

describe("advertising document boundary", () => {
  it("keeps the timer and its shared layout free of advertising loaders", () => {
    for (const file of [
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/components/nothing-app.tsx",
    ]) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source).not.toMatch(/adm\.shinobi\.jp|admax-ads|admaxads/);
    }
  });

  it("has one complete banner on the standalone guide and ordinary return links", () => {
    const template = document.createElement("template");
    template.innerHTML = readFileSync(resolve(root, "public/about.html"), "utf8");
    const guide = template.content;
    const slots = guide.querySelectorAll(".admax-ads");
    expect(slots).toHaveLength(1);
    expect((slots[0] as HTMLElement).style.width).toBe("300px");
    expect((slots[0] as HTMLElement).style.height).toBe("250px");
    expect(slots[0].getAttribute("data-admax-id")).toMatch(/^[a-f0-9]{32}$/);
    expect(guide.querySelectorAll('script[src="https://adm.shinobi.jp/st/t.js"]')).toHaveLength(1);
    expect(guide.querySelectorAll('a[href="/"]').length).toBeGreaterThan(0);
    expect(guide.querySelectorAll("iframe, form")).toHaveLength(0);
    expect(guide.querySelector('meta[http-equiv="Content-Security-Policy"]')).toBeNull();
  });

  it("retains timer and worker CSP while allowing advertising only on the exact guide path", async () => {
    const headers = await nextConfig.headers?.();
    if (!headers) throw new Error("Expected response header rules");
    const timer = headers.find((rule) => rule.source === "/:path*");
    const worker = headers.find((rule) => rule.source === "/sw.js");
    const guide = headers.find((rule) => rule.source === "/about.html");
    const timerCsp = timer?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    const workerCsp = worker?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    const guideCsp = guide?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    expect(timerCsp).toContain("default-src 'self'");
    expect(timerCsp).toContain("connect-src 'self' https://vitals.vercel-insights.com");
    expect(timerCsp).not.toContain("shinobi");
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
