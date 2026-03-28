import AssetLibraryPage from "@/components/library/AssetLibraryPage";
import StudioShell from "@/components/studio/StudioShell";

export default function StudioLibraryRoutePage() {
  return (
    <StudioShell
      title="资产库"
      description="统一浏览角色、场景、道具与来源归属，把资产沉淀成可复用资源中心。"
    >
      <AssetLibraryPage />
    </StudioShell>
  );
}
