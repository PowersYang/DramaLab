import { CheckCircle2, Building2, Sparkles, Users2 } from "lucide-react";

import MarketingShell from "@/components/site/MarketingShell";

const sections = [
  {
    icon: Building2,
    title: "短剧公司",
    body: "围绕项目矩阵、系列资产、批量生产与交付节奏设计，帮助团队把创意工作流产品化。",
    points: ["系列化内容管理", "共享角色/场景/道具资产", "统一任务追踪", "更适合多角色协作"],
  },
  {
    icon: Users2,
    title: "内容团队 / MCN",
    body: "适合题材试产、风格迭代、批量内容制作和多账号矩阵运营。",
    points: ["快速起多个选题项目", "保留标准化流程", "用任务中心统一追踪", "沉淀复用型资产库"],
  },
  {
    icon: Sparkles,
    title: "个人创作者",
    body: "保留快速创作路径，弱化系统配置暴露，让创作者聚焦脚本、风格和成片。",
    points: ["AI 智能推荐风格", "从剧本到成片的一站式流程", "更轻的项目管理负担", "更清晰的资产复用入口"],
  },
];

export default function SolutionsPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">解决方案</p>
        <h1 className="mt-4 max-w-4xl text-5xl font-bold text-slate-950">为短剧公司、内容团队和个人创作者设计的商业化工作流。</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
          同一套产品底座，不同角色通过不同工作方式完成内容生产，但都共享项目管理、任务追踪、风格资产和交付体系。
        </p>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-20 lg:px-10 xl:grid-cols-3">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <div key={section.title} className="studio-panel p-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon size={22} />
              </div>
              <h2 className="mt-6 text-2xl font-bold text-slate-950">{section.title}</h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">{section.body}</p>
              <div className="mt-6 space-y-3">
                {section.points.map((point) => (
                  <div key={point} className="flex items-center gap-3 text-sm text-slate-700">
                    <CheckCircle2 size={16} className="text-primary" />
                    {point}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </MarketingShell>
  );
}
