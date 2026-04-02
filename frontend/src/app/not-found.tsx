import type { Metadata } from "next";

import NotFoundStage from "@/components/site/NotFoundStage";

export const metadata: Metadata = {
  title: "404 | DramaLab",
};

export default function NotFound() {
  return <NotFoundStage variant="site" />;
}

