import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://doing-nothing-timer.vercel.app/",
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
