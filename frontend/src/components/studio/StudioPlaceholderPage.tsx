interface StudioPlaceholderPageProps {
  eyebrow: string;
  title: string;
  description: string;
  highlights: string[];
}

export default function StudioPlaceholderPage({ eyebrow, title, description, highlights }: StudioPlaceholderPageProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
      <section className="studio-panel p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">{eyebrow}</p>
        <h2 className="mt-3 text-3xl font-bold text-slate-950">{title}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">{description}</p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {highlights.map((item) => (
            <div key={item} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 text-sm font-medium text-slate-700">
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="studio-panel bg-slate-950 p-8 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Coming Soon</p>
        <h3 className="mt-3 text-2xl font-semibold">管理员与企业能力将在这里集中承接。</h3>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          本轮先完成商业化工作台的结构与展示层，后续再接入真实成员、权限、账单与席位数据。
        </p>
      </section>
    </div>
  );
}
