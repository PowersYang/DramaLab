import { ArrowRight, Clapperboard, Layers3, Workflow } from "lucide-react";
import Link from "next/link";

import LegacyHashRedirector from "@/components/site/LegacyHashRedirector";
import MarketingShell from "@/components/site/MarketingShell";
import MarketingVideoStage, { type MarketingVideoClip } from "@/components/site/MarketingVideoStage";

// 中文注释：官网首页继续保持“固定舞台 + 滚动叙事”，但正文信息收缩到更少、更安静的几块内容。
const videoClips: MarketingVideoClip[] = [
  {
    src: "/videos/marketing/video_61f4008c-939e-4c60-be56-0ad6053cd932.mp4",
    poster: "/images/marketing/video_61f4008c-939e-4c60-be56-0ad6053cd932.jpg",
    objectPosition: "center center",
  },
  {
    src: "/videos/marketing/video_d114e1e9-c60d-4ed1-96c7-814388d7d0ee.mp4",
    poster: "/images/marketing/video_d114e1e9-c60d-4ed1-96c7-814388d7d0ee.jpg",
    objectPosition: "center center",
  },
  {
    src: "/videos/marketing/video_12834f7a-acc4-4a48-955c-6a4e4de7e4b7.mp4",
    poster: "/images/marketing/video_12834f7a-acc4-4a48-955c-6a4e4de7e4b7.jpg",
    objectPosition: "center center",
  },
  {
    src: "/videos/marketing/video_5c3d75a3-8fd5-4282-b92b-f90a58f98b38.mp4",
    poster: "/images/marketing/video_5c3d75a3-8fd5-4282-b92b-f90a58f98b38.jpg",
    objectPosition: "center center",
  },
  {
    src: "/videos/marketing/video_7d2426cb-aef6-487d-a19f-08dd2d4cb470.mp4",
    poster: "/images/marketing/video_7d2426cb-aef6-487d-a19f-08dd2d4cb470.jpg",
    objectPosition: "center center",
  },
];

const featureCards = [
  {
    icon: Clapperboard,
    title: "剧本到镜头",
    body: "把结构拆解、分镜理解与生成入口压进同一条生产链路，不再在多个工具之间来回跳转。",
  },
  {
    icon: Layers3,
    title: "资产持续复用",
    body: "角色、场景、风格和参考资产被沉淀为长期可复用素材，而不是一次性内容。",
  },
  {
    icon: Workflow,
    title: "任务有序推进",
    body: "异步任务、失败回写与结果导出都保持可追踪，让团队协作不再依赖口头同步。",
  },
];

export default function HomePage() {
  return (
    <MarketingShell ctaMode="auth" theme="dark">
      <LegacyHashRedirector />
      <MarketingVideoStage clips={videoClips} />

      <div className="relative z-10 overflow-x-clip">
        <section className="px-6 pb-8 pt-16 lg:px-10 lg:pb-10 lg:pt-24">
          <div className="mx-auto flex min-h-[min(84svh,820px)] max-w-7xl items-start pt-[calc(clamp(2.5rem,9vh,7rem)+100px)]">
            <div className="max-w-[66rem]">
              <h1 className="marketing-editorial-title max-w-6xl text-balance text-[3.6rem] leading-[0.86] text-white md:text-[5.9rem]">
                为 AI 短剧生产打造的
                <span className="block text-white/74">控制台与秩序。</span>
              </h1>
              <p className="mt-8 max-w-2xl text-base leading-8 text-white/68 md:text-lg">
                DramaLab 把剧本分析、角色与场景资产、分镜生成、视频生产和导出交付收进同一个系统，让创作团队能像运营一条内容产线一样稳定推进项目。
              </p>
            </div>
          </div>
        </section>

        <section className="-mt-14 px-6 pb-24 lg:-mt-[4.5rem] lg:px-10 lg:pb-28">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-4 md:grid-cols-3">
              {featureCards.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="marketing-editorial-panel rounded-[1.9rem] p-6 md:p-7">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-[#f1d8ab]">
                      <Icon size={18} />
                    </div>
                    <h2 className="mt-6 font-display text-[2rem] leading-none tracking-[-0.04em] text-white">{item.title}</h2>
                    <p className="mt-4 text-sm leading-7 text-white/64 md:text-base">{item.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
