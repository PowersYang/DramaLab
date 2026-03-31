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
  const [collapsedSources, setCollapsedSources] = useState<Set<string>>(new Set());

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

  const totals = useMemo(
    () => [
      { label: "资产来源", value: sources.length, note: "已建索引的系列与项目来源", icon: Layers3 },
      {
        label: "角色库存",
        value: sources.reduce((sum, source) => sum + source.characters.length, 0),
        note: "角色资产总量",
        icon: Users,
      },
      {
        label: "场景库存",
        value: sources.reduce((sum, source) => sum + source.scenes.length, 0),
        note: "场景资产总量",
        icon: MapPin,
      },
      {
        label: "道具库存",
        value: sources.reduce((sum, source) => sum + source.props.length, 0),
        note: "道具资产总量",
        icon: Package,
      },
    ],
    [sources],
  );

  const sourceOverview = useMemo(
    () => ({
      series: sources.filter((source) => source.type === "series").length,
      project: sources.filter((source) => source.type === "project").length,
      activeInventory: filteredSources.reduce((sum, source) => sum + getAssetCount(source, activeTab), 0),
    }),
    [activeTab, filteredSources, sources],
  );

  const toggleCollapse = (sourceId: string) => {
    setCollapsedSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <section className="studio-panel overflow-hidden">
        <div
          className="grid gap-6 border-b px-5 py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:px-6"
          style={{ borderColor: "var(--studio-shell-border)" }}
        >
          <div>
            <div className="studio-eyebrow">Asset Inventory</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] studio-strong">资产库存与来源台账</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 studio-muted">
              资产库改成后台管理视角，先看库存规模、资产来源和当前检索命中，再下钻到系列或项目维度处理具体资产。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="studio-kpi">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] studio-faint">Source Split</p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] studio-strong">{sourceOverview.series + sourceOverview.project}</p>
              <p className="mt-2 text-xs leading-6 studio-muted">系列来源 {sourceOverview.series} · 项目来源 {sourceOverview.project}</p>
            </div>
            <div className="studio-kpi">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] studio-faint">Active Inventory</p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] studio-strong">{sourceOverview.activeInventory}</p>
              <p className="mt-2 text-xs leading-6 studio-muted">
                当前正在查看“{tabs.find((item) => item.id === activeTab)?.label}”，{searchQuery.trim() ? "已应用检索过滤" : "未应用关键词过滤"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-5 md:grid-cols-2 xl:grid-cols-4 lg:px-6">
          {totals.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="studio-kpi">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] studio-faint">{item.label}</div>
                  <span className="studio-stat-icon">
                    <Icon size={16} />
                  </span>
                </div>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] studio-strong">{item.value}</p>
                <p className="mt-2 text-xs leading-6 studio-muted">{item.note}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="studio-panel px-5 py-4 lg:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="studio-tab-strip flex flex-wrap items-center gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`studio-tab ${activeTab === tab.id ? "studio-tab-active" : ""}`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>

          <label className="relative block w-full lg:w-[22rem]">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 studio-faint" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索资产名称或描述"
              className="studio-input rounded-full py-3 pl-11 pr-4 text-sm"
            />
          </label>
        </div>
        <p className="mt-3 text-sm studio-muted">{tabs.find((item) => item.id === activeTab)?.note}</p>
      </section>

      {loading ? (
        <div className="studio-panel flex items-center justify-center py-20">
          <div className="text-sm studio-muted">资产库存加载中...</div>
        </div>
      ) : filteredSources.length === 0 ? (
        <div className="studio-panel flex flex-col items-center justify-center py-20 text-center">
          <ImageIcon size={48} className="mb-3 text-slate-400" />
          <p className="text-base font-semibold studio-strong">当前筛选条件下没有资产</p>
          <p className="mt-2 text-sm leading-7 studio-muted">在系列或项目中生成资产后会自动归档到这里，也可以清空关键词恢复全量库存视图。</p>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(280px,0.34fr)_minmax(0,0.66fr)]">
          <section className="studio-panel overflow-hidden">
            <div
              className="border-b px-5 py-4"
              style={{ borderColor: "var(--studio-shell-border)", background: "var(--studio-shell-panel-soft)" }}
            >
              <div className="studio-eyebrow">Source Ledger</div>
              <h3 className="mt-2 text-xl font-semibold studio-strong">资产来源台账</h3>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--studio-shell-border)" }}>
              {filteredSources.map((source) => {
                const count = getAssetCount(source, activeTab);
                return (
                  <div key={`summary-${source.id}`} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="studio-badge studio-badge-soft">{source.type === "series" ? "系列" : "项目"}</span>
                          <p className="truncate text-sm font-semibold studio-strong">{source.name}</p>
                        </div>
                        <p className="mt-2 text-xs leading-6 studio-muted">当前分类资产 {count} 条，可在右侧库存区展开查看明细。</p>
                      </div>
                      <span className="studio-mini-chip">{count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            {filteredSources.map((source) => {
              const assets: (Character | Scene | Prop)[] =
                activeTab === "characters" ? source.characters : activeTab === "scenes" ? source.scenes : source.props;
              if (assets.length === 0) return null;

              const isCollapsed = collapsedSources.has(source.id);
              const sourceCount = getAssetCount(source, activeTab);

              return (
                <div key={source.id} className="studio-admin-block">
                  <div className="studio-admin-ledger-row">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="studio-badge studio-badge-soft">{source.type === "series" ? "系列库存" : "项目库存"}</span>
                        <p className="truncate text-base font-semibold studio-strong">{source.name}</p>
                      </div>
                      <p className="mt-2 text-sm leading-6 studio-muted">
                        当前分类下共有 {sourceCount} 条资产记录，{source.type === "series" ? "适合统一管理共享设定与母版素材。" : "适合处理单体项目的专属资产。"}
                      </p>
                    </div>

                    <div className="studio-admin-meta">
                      <div>
                        <div className="studio-admin-meta-label">角色</div>
                        <div className="studio-admin-meta-value">{source.characters.length}</div>
                      </div>
                      <div>
                        <div className="studio-admin-meta-label">场景</div>
                        <div className="studio-admin-meta-value">{source.scenes.length}</div>
                      </div>
                      <div>
                        <div className="studio-admin-meta-label">道具</div>
                        <div className="studio-admin-meta-value">{source.props.length}</div>
                      </div>
                      <div>
                        <div className="studio-admin-meta-label">当前分类</div>
                        <div className="studio-admin-meta-value">{sourceCount}</div>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button onClick={() => toggleCollapse(source.id)} className="studio-button studio-button-secondary">
                        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        {isCollapsed ? "展开库存" : "收起库存"}
                      </button>
                    </div>
                  </div>

                  {!isCollapsed ? (
                    <div
                      className="border-t px-5 py-5"
                      style={{ borderColor: "var(--studio-shell-border)", background: "color-mix(in srgb, var(--studio-shell-panel-strong) 96%, transparent)" }}
                    >
                      <div className="mb-4 flex flex-wrap items-center gap-3">
                        <span className="studio-mini-chip">
                          {source.type === "series" ? <Layers3 size={12} /> : <FolderKanban size={12} />}
                          {source.type === "series" ? "系列来源" : "项目来源"}
                        </span>
                        <span className="studio-mini-chip">{tabs.find((item) => item.id === activeTab)?.label}</span>
                        <span className="studio-mini-chip">共 {sourceCount} 条</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                        {assets.map((asset) => (
                          <AssetCard key={asset.id} asset={asset} type={activeTab} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
