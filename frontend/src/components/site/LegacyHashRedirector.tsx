"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const resolveLegacyHash = (hash: string) => {
  const normalized = hash.replace(/^#/, "");

  if (normalized.startsWith("/project/")) {
    return `/studio/projects/${normalized.replace("/project/", "")}`;
  }

  const seriesEpisodeMatch = normalized.match(/^\/series\/([^/]+)\/episode\/([^/]+)$/);
  if (seriesEpisodeMatch) {
    return `/studio/projects/${seriesEpisodeMatch[2]}?seriesId=${seriesEpisodeMatch[1]}`;
  }

  const seriesMatch = normalized.match(/^\/series\/([^/]+)$/);
  if (seriesMatch) {
    return `/studio/series/${seriesMatch[1]}`;
  }

  if (normalized === "/library") {
    return "/studio/library";
  }

  if (normalized === "/" || normalized === "") {
    return "/studio/projects";
  }

  return null;
};

export default function LegacyHashRedirector() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) {
      return;
    }

    const target = resolveLegacyHash(window.location.hash);
    if (target) {
      router.replace(target);
    }
  }, [router]);

  return null;
}
