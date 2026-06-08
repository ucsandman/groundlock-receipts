import type { MetadataRoute } from "next";
import { absoluteUrl } from "../lib/site-url";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl("/"),
    },
    {
      url: absoluteUrl("/threat-model"),
    },
  ];
}
