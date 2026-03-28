"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Users, MapPin, Package, Image as ImageIcon, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import AssetCard from "@/components/common/AssetCard";
import { useProjectStore, type Series, type Project, type Character, type Scene, type Prop } from "@/store/projectStore";

type AssetTab = "characters" | "scenes" | "props";

interface AssetSource {
  id: string;
  name: string;
  type: "series" | "project";
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
}

const buildAssetSources = (seriesList: Series[], projects: Project[]): AssetSource[] => {
  const result: AssetSource[] = [];

  for (const series of seriesList) {
    if ((series.characters?.length || 0) + (series.scenes?.length || 0) + (series.props?.length || 0) > 0) {
      result.push({
        id: `series-${series.id}`,
        name: series.title,
        type: "series",
        characters: series.characters || [],
        scenes: series.scenes || [],
        props: series.props || [],
      });
    }
  }

  for (const project of projects.filter((item) => !item.series_id)) {
    if ((project.characters?.length || 0) + (project.scenes?.length || 0) + (project.props?.length || 0) > 0) {
      result.push({
        id: `project-${project.id}`,
        name: project.title,
        type: "project",
        characters: project.characters || [],
        scenes: project.scenes || [],
        props: project.props || [],
      });
    }
  }

  return result;
};

export default function AssetLibraryPage() {
  const cachedSeriesList = useProjectStore((state) => state.seriesList);
  const cachedProjects = useProjectStore((state) => state.projects);
  const setSeriesList = useProjectStore((state) => state.setSeriesList);
  const setProjects = useProjectStore((state) => state.setProjects);
  const [sources, setSources] = useState<AssetSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AssetTab>("characters");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedSources, setCollapsedSources] = useState<Set<string>>(new Set());

  useEffect(() => {
    // 优先用 store 里的项目/系列缓存秒开页面，再异步刷新后端数据。
    if (cachedSeriesList.length > 0 || cachedProjects.length > 0) {
      setSources(buildAssetSources(cachedSeriesList, cachedProjects));
    } else {
      setLoading(true);
    }

    void loadAssets();
    // 这里故意只在首次挂载时触发，避免 store 刷新后再次重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAssets = async () => {
    if (sources.length === 0) {
      setLoading(true);
    }

    try {
      const [seriesList, projects] = await Promise.all([
        api.listSeries(),
        api.getProjects(),
      ]);
      setSeriesList(seriesList);
      setProjects(projects);
      setSources(buildAssetSources(seriesList as Series[], projects as Project[]));
    } catch (error) {
      console.error("Failed to load asset library:", error);
    } finally {
      setLoading(false);
    }
  };

  const tabs: { id: AssetTab; label: string; icon: typeof Users }[] = [
    { id: "characters", label: "角色", icon: Users },
    { id: "scenes", label: "场景", icon: MapPin },
    { id: "props", label: "道具", icon: Package },
  ];

  const filteredSources = useMemo(() => {
    if (!searchQuery.trim()) return sources;
    const q = searchQuery.toLowerCase();
    return sources
      .map((source) => ({
        ...source,
        characters: source.characters.filter((a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)),
        scenes: source.scenes.filter((a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)),
        props: source.props.filter((a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)),
      }))
      .filter((s) => {
        const count = activeTab === "characters" ? s.characters.length : activeTab === "scenes" ? s.scenes.length : s.props.length;
        return count > 0;
      });
  }, [sources, searchQuery, activeTab]);

  const toggleCollapse = (sourceId: string) => {
    setCollapsedSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="studio-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${
                  activeTab === tab.id
                    ? "bg-primary text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-950"
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative w-full lg:w-80">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索资产..."
              className="w-full rounded-full border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition-colors focus:border-primary focus:bg-white"
            />
          </div>
        </div>
      </section>

      {loading ? (
        <div className="studio-panel flex items-center justify-center py-20">
          <div className="text-slate-500">加载中...</div>
        </div>
      ) : filteredSources.length === 0 ? (
        <div className="studio-panel flex flex-col items-center justify-center py-20 text-slate-500">
          <ImageIcon size={48} className="mb-3 text-slate-400" />
          <p className="text-sm">暂无资产</p>
          <p className="mt-1 text-xs text-slate-400">在系列或项目中生成资产后，它们会出现在这里</p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredSources.map((source) => {
            const assets: (Character | Scene | Prop)[] =
              activeTab === "characters" ? source.characters : activeTab === "scenes" ? source.scenes : source.props;
            if (assets.length === 0) return null;
            const isCollapsed = collapsedSources.has(source.id);

            return (
              <div key={source.id} className="studio-panel p-6">
                <button
                  onClick={() => toggleCollapse(source.id)}
                  className="mb-4 flex items-center gap-2 text-sm text-slate-600 transition-colors hover:text-slate-950"
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span className="font-medium">{source.name}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {source.type === "series" ? "系列" : "项目"} · {assets.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-2 gap-4 pl-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {assets.map((asset) => (
                      <AssetCard key={asset.id} asset={asset} type={activeTab} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
