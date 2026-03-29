import type { ReactNode } from "react";

import StudioAuthGate from "@/components/studio/StudioAuthGate";
import StudioWorkspaceFrame from "@/components/studio/StudioWorkspaceFrame";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <StudioAuthGate>
      <StudioWorkspaceFrame>{children}</StudioWorkspaceFrame>
    </StudioAuthGate>
  );
}
