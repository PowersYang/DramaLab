"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Image as ImageIcon,
  Layers3,
  MapPin,
  Package,
  Search,
  Users,
} from "lucide-react";

import AssetCard from "@/components/common/AssetCard";
import { api } from "@/lib/api";
import { useProjectStore, type Character, type Project, type Prop, type Scene, type Series } from "@/store/projectStore";

type AssetTab = "characters" | "scenes" | "props";

interface AssetSource {
  id: string;
  name: string;
  type: "series" | "project";
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
}

const ASSET_LIBRARY_CACHE_KEY = "dramalab-asset-library-cache-v1";

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

const readAssetLibraryCache = (): AssetSource[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(ASSET_LIBRARY_CACHE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as { sources?: AssetSource[] } | null;
    return Array.isArray(parsed?.sources) ? parsed.sources : [];
  } catch (error) {
    console.error("Failed to read asset library cache:", error);
    return [];
  }
};

const writeAssetLibraryCache = (sources: AssetSource[]) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      ASSET_LIBRARY_CACHE_KEY,
      JSON.stringify({
        updated_at: Date.now(),
        sources,
      }),
    );
  } catch (error) {
    console.error("Failed to write asset library cache:", error);
  }
};

const scheduleDeferredRefresh = (task: () => void) => {
  if (typeof window === "undefined") {
    task();
    return () => undefined;
  }

  // 中文注释：命中缓存时把完整资产刷新推迟到空闲时段，避免切页先被非关键数据阻塞。
  if ("requestIdleCallback" in window) {
    const idleId = window.requestIdleCallback(() => task(), { timeout: 1200 });
    return () => window.cancelIdleCallback(idleId);
  }

  const timeoutId = globalThis.setTimeout(task, 180);
  return () => globalThis.clearTimeout(timeoutId);
};

const getAssetCount = (source: AssetSource, activeTab: AssetTab) =>
  activeTab === "characters" ? source.characters.length : activeTab === "scenes" ? source.scenes.length : source.props.length;

export default function AssetLibraryPage() {
  const cachedSeriesList = useProjectStore((state) => state.seriesList);
  const cachedProjects = useProjectStore((state) => state.projects);
  const setSeriesList = useProjectStore((state) => state.setSeriesList);
  const setProjects = useProjectStore((state) => state.setProjects);
  const [sources, setSources] = useState<AssetSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AssetTab>("characters");
  const [searchQuery, setSearchQuery] = useState("");

  const loadAssets = async (forceLoading = false) => {
    if (forceLoading) {
      setLoading(true);
    }

    try {
      const [seriesList, projects] = await Promise.all([api.listSeries(), api.getProjects()]);
      setSeriesList(seriesList);
      setProjects(projects);
      const nextSources = buildAssetSources(seriesList as Series[], projects as Project[]);
      setSources(nextSources);
      writeAssetLibraryCache(nextSources);
    } catch (error) {
      console.error("Failed to load asset library:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let hasWarmCache = false;

    // 中文注释：资产库优先复用 store 或 session 缓存秒开页面，再静默刷新远端。
    if (cachedSeriesList.length > 0 || cachedProjects.length > 0) {
      const nextSources = buildAssetSources(cachedSeriesList, cachedProjects);
      setSources(nextSources);
      writeAssetLibraryCache(nextSources);
      setLoading(false);
      hasWarmCache = true;
    } else {
      const sessionCachedSources = readAssetLibraryCache();
      if (sessionCachedSources.length > 0) {
        setSources(sessionCachedSources);
        setLoading(false);
        hasWarmCache = true;
      }
    }

    const cancelDeferredRefresh = hasWarmCache
      ? scheduleDeferredRefresh(() => {
          if (!cancelled) {
            void loadAssets(false);
          }
        })
      : (() => {
          void loadAssets(true);
          return () => undefined;
        })();

    return () => {
      cancelled = true;
      cancelDeferredRefresh();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { id: AssetTab; label: string; icon: typeof Users; note: string }[] = [
    { id: "characters", label: "角色库存", icon: Users, note: "人物设定、立绘与角色资产" },
    { id: "scenes", label: "场景库存", icon: MapPin, note: "场景母版、镜头空间与背景资源" },
    { id: "props", label: "道具库存", icon: Package, note: "高频道具、通用素材与可复用物件" },
  ];

  const filteredSources = useMemo(() => {
    if (!searchQuery.trim()) return sources;
    const q = searchQuery.toLowerCase();
    return sources
      .map((source) => ({
        ...source,
        characters: source.characters.filter((asset) => asset.name.toLowerCase().includes(q) || asset.description?.toLowerCase().includes(q)),
        scenes: source.scenes.filter((asset) => asset.name.toLowerCase().includes(q) || asset.description?.toLowerCase().includes(q)),
        props: source.props.filter((asset) => asset.name.toLowerCase().includes(q) || asset.description?.toLowerCase().includes(q)),
      }))
      .filter((source) => getAssetCount(source, activeTab) > 0);
  }, [activeTab, searchQuery, sources]);

  const sourceOverview = useMemo(
    () => ({
      activeInventory: filteredSources.reduce((sum, source) => sum + getAssetCount(source, activeTab), 0),
    }),
    [activeTab, filteredSources],
  );

  return (
    <div className="space-y-6 pb-20">
      {/* ── 交互栏：选项卡与搜索 ── */}
      <section className="sticky top-[-1px] z-20 -mx-1 px-1 py-3 bg-background/80 backdrop-blur-md">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between p-1.5 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-50">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive 
                      ? "bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200" 
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-100/50"
                  }`}
                >
                  <Icon size={16} className={isActive ? "text-indigo-500" : "text-slate-400"} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索资产名称、描述或来源..."
              className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 transition-all placeholder:text-slate-400"
            />
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 animate-pulse">
          <div className="h-10 w-10 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin mb-4" />
          <p className="text-sm font-medium text-slate-500">正在整理资产库存...</p>
        </div>
      ) : filteredSources.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 px-6 rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/50">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-6 text-slate-400">
            <ImageIcon size={32} />
          </div>
          <h3 className="text-lg font-bold text-slate-900">未找到相关资产</h3>
          <p className="mt-2 text-sm text-slate-500 text-center max-w-xs">
            {searchQuery.trim() 
              ? `未找到匹配 "${searchQuery}" 的资产记录，请尝试其他关键词。` 
              : "当前还没有生成的资产记录。"}
          </p>
          {searchQuery.trim() && (
            <button 
              onClick={() => setSearchQuery("")}
              className="mt-6 text-sm font-bold text-indigo-600 hover:text-indigo-700"
            >
              清除搜索条件
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-10">
          {filteredSources.map((source) => {
            const assets: (Character | Scene | Prop)[] =
              activeTab === "characters" ? source.characters : activeTab === "scenes" ? source.scenes : source.props;
            if (assets.length === 0) return null;

            const sourceCount = getAssetCount(source, activeTab);

            return (
              <div key={source.id} className="group">
                {/* ── 来源标题 ── */}
                <div className="flex items-center justify-between mb-6 px-1">
                  <div className="flex items-center gap-4">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                      source.type === "series" ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                    }`}>
                      {source.type === "series" ? <Layers3 size={20} /> : <FolderKanban size={20} />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-900">{source.name}</h3>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          source.type === "series" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {source.type === "series" ? "系列" : "项目"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {source.type === "series" ? "全局共享资产" : "专属项目资产"} · 共 {sourceCount} 条记录
                      </p>
                    </div>
                  </div>
                  
                  <div className="h-px flex-1 mx-8 bg-slate-100" />
                  
                  <button className="text-xs font-bold text-slate-400 hover:text-indigo-600 transition-colors">
                    查看全部
                  </button>
                </div>

                {/* ── 资产网格 ── */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {assets.map((asset) => (
                    <AssetCard key={asset.id} asset={asset} type={activeTab} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )
    }
    </div>
  );
}
