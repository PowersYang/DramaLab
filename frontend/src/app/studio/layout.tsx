import type { ReactNode } from "react";

import StudioAuthGate from "@/components/studio/StudioAuthGate";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return <StudioAuthGate>{children}</StudioAuthGate>;
}
