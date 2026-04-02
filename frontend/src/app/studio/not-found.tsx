import type { Metadata } from "next";

import NotFoundStage from "@/components/site/NotFoundStage";

export const metadata: Metadata = {
  title: "404 | DramaLab Studio",
};

export default function StudioNotFound() {
  return <NotFoundStage variant="studio" />;
}

