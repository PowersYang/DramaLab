import MarketingShell from "@/components/site/MarketingShell";

const tiers = [
  {
    name: "Starter",
    price: "¥299 / 月",
    description: "适合个人创作者与题材验证阶段。",
    features: ["单工作区", "核心创作链路", "基础任务追踪", "资产库浏览"],
  },
  {
    name: "Professional",
    price: "¥1299 / 月",
    description: "适合小团队和多项目并行生产。",
    features: ["多项目管理", "系列资产复用", "统一任务中心", "团队页与账号设置壳"],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "联系销售",
    description: "适合短剧公司、MCN 与商业化内容团队。",
    features: ["定制席位与权限", "组织/工作区扩展", "计费与配额策略", "企业级交付支持"],
  },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">套餐定价</p>
        <h1 className="mt-4 text-5xl font-bold text-slate-950">商业化套餐壳已经就位，后续可接真实计费能力。</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
          当前页面用于商业展示和产品定位，不绑定真实支付逻辑，但会完整承载平台级套餐表达。
        </p>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-20 lg:px-10 xl:grid-cols-3">
        {tiers.map((tier) => (
          <div key={tier.name} className={`studio-panel p-8 ${tier.featured ? "ring-2 ring-primary/25" : ""}`}>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{tier.name}</p>
            <p className="mt-4 text-4xl font-bold text-slate-950">{tier.price}</p>
            <p className="mt-4 text-sm leading-7 text-slate-600">{tier.description}</p>
            <div className="mt-8 space-y-3 text-sm text-slate-700">
              {tier.features.map((feature) => (
                <div key={feature} className="rounded-[1.25rem] bg-slate-50 px-4 py-3">{feature}</div>
              ))}
            </div>
            <button className={`mt-8 w-full rounded-full px-5 py-3 text-sm font-semibold ${tier.featured ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700"}`}>
              {tier.name === "Enterprise" ? "预约演示" : "开始使用"}
            </button>
          </div>
        ))}
      </section>
    </MarketingShell>
  );
}
