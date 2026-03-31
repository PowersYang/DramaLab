import Link from "next/link";

type MarketingFooterTheme = "light" | "dark";

interface MarketingFooterProps {
  theme?: MarketingFooterTheme;
}

interface FooterLinkItem {
  label: string;
  href: string;
  external?: boolean;
}

interface FooterSection {
  title: string;
  links: FooterLinkItem[];
}

// 中文注释：营销页 footer 导航先收敛为纯配置，后续接入真实站点链接时只需替换 href。
const footerSections: FooterSection[] = [
  {
    title: "产品",
    links: [
      { label: "功能概览", href: "#product-overview" },
      { label: "工作流", href: "#workflow" },
      { label: "价格方案", href: "/pricing" },
    ],
  },
  {
    title: "资源",
    links: [
      { label: "文档中心", href: "/docs" },
      { label: "常见问题", href: "/faq" },
      { label: "更新日志", href: "/changelog" },
      { label: "GitHub", href: "https://github.com/", external: true },
    ],
  },
  {
    title: "场景",
    links: [
      { label: "短剧团队", href: "/solutions/short-drama-teams" },
      { label: "MCN / 内容机构", href: "/solutions/mcn-content-studios" },
      { label: "品牌剧情广告", href: "/solutions/branded-story-ads" },
      { label: "系列化内容生产", href: "/solutions/serialized-production" },
    ],
  },
  {
    title: "联系",
    links: [
      { label: "商务合作", href: "/contact/business" },
      { label: "联系我们", href: "/contact" },
      { label: "隐私政策", href: "/privacy" },
      { label: "用户协议", href: "/terms" },
    ],
  },
];

// 中文注释：底部次级法务链接保持轻量密度，方便在商业化阶段继续补备案与公司主体信息。
const footerLegalLinks: FooterLinkItem[] = [
  { label: "GitHub", href: "https://github.com/", external: true },
  { label: "隐私政策", href: "/privacy" },
  { label: "用户协议", href: "/terms" },
];

function FooterLink({ item, className }: { item: FooterLinkItem; className: string }) {
  const commonProps = item.external ? { target: "_blank", rel: "noreferrer" } : undefined;

  return (
    <Link href={item.href} className={className} {...commonProps}>
      {item.label}
    </Link>
  );
}

export default function MarketingFooter({ theme = "light" }: MarketingFooterProps) {
  const isDark = theme === "dark";
  const shellClassName = isDark
    ? "border-white/10 bg-[#050910]/88 text-white"
    : "border-slate-200/80 bg-white/88 text-slate-900";
  const panelClassName = isDark
    ? "border-white/10 bg-white/[0.035] shadow-[0_30px_120px_rgba(0,0,0,0.26)]"
    : "border-slate-200/80 bg-white/80 shadow-[0_20px_80px_rgba(15,23,42,0.08)]";
  const eyebrowClassName = isDark ? "text-[#f1d8ab]/82" : "text-primary/80";
  const summaryClassName = isDark ? "text-white/78" : "text-slate-700";
  const bodyClassName = isDark ? "text-white/56" : "text-slate-600";
  const sectionTitleClassName = isDark ? "text-white/92" : "text-slate-950";
  const linkClassName = isDark
    ? "group inline-flex w-fit items-center text-sm leading-6 text-white/54 transition-all duration-300 hover:translate-x-[2px] hover:text-white/88"
    : "group inline-flex w-fit items-center text-sm leading-6 text-slate-600 transition-all duration-300 hover:translate-x-[2px] hover:text-slate-950";
  const legalClassName = isDark
    ? "text-sm text-white/44 transition-colors duration-300 hover:text-white/78"
    : "text-sm text-slate-500 transition-colors duration-300 hover:text-slate-900";

  return (
    <footer className={`relative border-t ${shellClassName}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(241,216,171,0.08),transparent_62%)]" />

      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-10 lg:py-10">
        <div
          className={`relative overflow-hidden rounded-[2rem] border backdrop-blur-2xl ${panelClassName}`}
          aria-label="DramaLab 网站页脚"
        >
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.01)_100%)]" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/10" />

          <div className="relative grid gap-12 px-6 py-8 md:px-8 md:py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.45fr)] lg:gap-16 lg:px-10 lg:py-12">
            <section aria-labelledby="marketing-footer-brand" className="max-w-xl">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.34em] ${eyebrowClassName}`}>DramaLab</p>
              <h2
                id="marketing-footer-brand"
                className={`mt-4 font-display text-[2.1rem] leading-[0.95] tracking-[-0.045em] ${isDark ? "text-white" : "text-slate-950"} md:text-[2.55rem]`}
              >
                面向短剧团队的 AI 制作与生产平台
              </h2>
              <p className={`mt-5 max-w-lg text-base leading-7 ${summaryClassName}`}>
                从剧本拆解到交付协同，把镜头语言、资产沉淀与生产节奏收进一套更安静、更可靠的系统。
              </p>
              <p className={`mt-4 max-w-xl text-sm leading-7 ${bodyClassName}`}>
                DramaLab 连接剧本分析、角色与场景资产、分镜生成、视频生产和交付协同，让内容团队以接近片场控制台的方式推进系列化创作。
              </p>
            </section>

            <nav aria-label="Footer navigation" className="grid gap-10 sm:grid-cols-2 xl:grid-cols-4 xl:gap-8">
              {footerSections.map((section) => (
                <section key={section.title} aria-labelledby={`footer-section-${section.title}`}>
                  <h3
                    id={`footer-section-${section.title}`}
                    className={`text-sm font-semibold tracking-[0.14em] ${sectionTitleClassName}`}
                  >
                    {section.title}
                  </h3>
                  <ul className="mt-5 space-y-3">
                    {section.links.map((item) => (
                      <li key={item.label}>
                        <FooterLink item={item} className={linkClassName} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </nav>
          </div>

          <div
            className={`relative flex flex-col gap-4 border-t px-6 py-5 md:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10 ${
              isDark ? "border-white/10 bg-black/10" : "border-slate-200/80 bg-slate-50/70"
            }`}
          >
            <p className={legalClassName}>© 2026 DramaLab. All rights reserved.</p>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {footerLegalLinks.map((item) => (
                <FooterLink key={item.label} item={item} className={legalClassName} />
              ))}
              {/* 中文注释：备案号位置暂时预留，待主体信息明确后直接替换文案与链接。 */}
              <span className={legalClassName}>备案号预留</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
