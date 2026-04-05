"use client";

import ArtDirectionEditorCard from "@/components/art-direction/ArtDirectionEditorCard";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";

export default function ProjectArtDirectionOverridePanel() {
  const currentProject = useProjectStore((state) => state.currentProject);
  const updateProject = useProjectStore((state) => state.updateProject);

  if (!currentProject) {
    return null;
  }

  return (
    <ArtDirectionEditorCard
      title="项目级美术覆写"
      description="这里只保存本集相对剧集主档的差异，不会改动整部剧的官方视觉标准。"
      initialArtDirection={currentProject.art_direction_resolved || currentProject.art_direction}
      actionLabel="保存项目覆写"
      onSave={async (selectedStyleId, styleConfig) => {
        const updated = await api.updateProjectArtDirectionOverride(currentProject.id, selectedStyleId, styleConfig);
        updateProject(currentProject.id, updated);
      }}
    />
  );
}
