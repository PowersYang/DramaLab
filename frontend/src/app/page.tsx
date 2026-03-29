import Link from "next/link";
import { ArrowRight, Building2, Clapperboard, Layers3, PlayCircle, Sparkles, Users2, Workflow } from "lucide-react";

import MarketingShell from "@/components/site/MarketingShell";
import LegacyHashRedirector from "@/components/site/LegacyHashRedirector";

const capabilities = [
  { title: "剧本分析", body: "从文本中提取角色、场景、道具和结构节奏，进入标准化生产流程。" },
  { title: "风格定调", body: "保留 AI 智能推荐风格与内置预设，快速建立统一视觉语言。" },
  { title: "资产生成", body: "角色、场景、道具在一个系统里沉淀，服务多项目与系列复用。" },
  { title: "分镜编排", body: "围绕镜头、画面与对白建立创作协同，不再依赖零散工具跳转。" },
  { title: "视频生产", body: "统一追踪长耗时生成任务，把 Motion、Assembly、Export 纳入同一工作台。" },
  { title: "交付导出", body: "从成片输出、版本管理到团队交付，面向真实商业生产场景设计。" },
];

const audience = [
  { icon: Building2, title: "短剧公司", body: "适合多项目并行、系列化生产、标准化资产复用和多角色协作。" },
  { icon: Users2, title: "MCN / 内容团队", body: "适合内容流水线、批量题材试产、运营与创作协同交付。" },
  { icon: Sparkles, title: "个人创作者", body: "适合单人快速验证题材、建立风格资产和完成完整生产闭环。" },
];

const workflow = [
  "剧本导入与结构分析",
  "AI 智能推荐风格与项目定调",
  "资产生成与系列共享",
  "分镜生成与镜头编排",
  "视频任务追踪与输出交付",
];

export default function HomePage() {
  return (
    <MarketingShell>
      <LegacyHashRedirector />

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-24">
        <div className="grid gap-10 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">商业化 AI 短剧创作平台</p>
            <h1 className="mt-5 max-w-4xl font-display text-5xl leading-tight text-slate-950 md:text-6xl">
              DramaLab 帮团队把短剧创作从“能做”推进到“能商业化交付”。
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              用统一工作台承接剧本分析、风格定调、资产沉淀、分镜生成、任务追踪和成片导出，让内容团队拥有真正可复用、可扩展、可运营的生产系统。
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/solutions" className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white shadow-sm">
                查看解决方案
                <ArrowRight size={16} />
              </Link>
              <Link href="/signup" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700">
                注册账号
              </Link>
            </div>
          </div>

          <div className="studio-panel overflow-hidden border border-slate-200 bg-white p-8 text-slate-900 shadow-[0_18px_44px_rgba(15,23,42,0.12)]">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-600">生产流程</p>
            <h2 className="mt-4 max-w-md font-display text-3xl leading-tight text-slate-950 md:text-[2rem]">
              把剧本拆解、资产生成与视频交付放进同一条生产链。
            </h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-slate-700">
              这组流程卡片强调 Studio 的完整生产节奏，从剧本解析到交付导出都放在同一个协同工作台里。
            </p>
            <div className="mt-8 space-y-4">
              {/* 中文注释：官网首页这里固定使用深色正文和浅色卡片，避免白底场景里步骤文案对比度不足。 */}
              {workflow.map((item, index) => (
                <div
                  key={item}
                  className="flex items-center gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-4"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-base font-semibold text-primary">
                    {index + 1}
                  </div>
                  <p className="text-base font-semibold leading-7 text-slate-900">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 lg:px-10">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "组织化生产", value: "多项目 / 多系列" },
            { label: "任务体系", value: "统一排队与重试" },
            { label: "资产沉淀", value: "跨项目复用" },
            { label: "交付节奏", value: "从脚本到成片" },
          ].map((item) => (
            <div key={item.label} className="studio-panel p-6">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <p className="mt-4 text-2xl font-bold text-slate-950">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">核心能力</p>
            <h2 className="mt-3 text-4xl font-bold text-slate-950">适合真实业务的创作能力，不只是开源演示页面。</h2>
          </div>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {capabilities.map((item) => (
            <div key={item.title} className="studio-panel p-6">
              <h3 className="text-xl font-semibold text-slate-950">{item.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">适用对象</p>
            <h2 className="mt-3 text-4xl font-bold text-slate-950">兼顾团队交付与个人创作效率。</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {audience.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="studio-panel p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon size={20} />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-950">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <div className="rounded-[2rem] bg-slate-950 px-8 py-10 text-white lg:px-12">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">立即开始</p>
              <h2 className="mt-3 text-4xl font-bold">把剧本、资产、任务和交付放进同一个商业工作台。</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">进入 DramaLab Studio，查看新的商业化首页、项目中心、任务中心与资源库布局。</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950">
                <PlayCircle size={16} />
                创建账号
              </Link>
              <Link href="/pricing" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white">
                查看套餐
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
