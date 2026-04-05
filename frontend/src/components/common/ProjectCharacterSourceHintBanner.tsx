"use client";

import type { Project } from "@/store/projectStore";
import { getProjectCharacterSourceHint } from "@/lib/projectAssets";

export default function ProjectCharacterSourceHintBanner({
  project,
  className = "",
}: {
  project?: Project | null;
  className?: string;
}) {
  const hint = getProjectCharacterSourceHint(project);
  if (!hint) return null;

  return (
    <div
      className={[
        "rounded-xl border border-[color:var(--studio-border-soft)] border-l-[3px] border-l-[color:var(--studio-shell-warning)]",
        "bg-[color:var(--studio-shell-warning-soft)] px-3 py-2 text-[12px] font-medium leading-5",
        "text-[color:var(--studio-shell-text-soft)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {hint}
    </div>
  );
}

