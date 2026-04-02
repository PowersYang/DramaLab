import Link from "next/link";

type NotFoundStageVariant = "site" | "studio";

type NotFoundStageProps = {
  variant?: NotFoundStageVariant;
};

export default function NotFoundStage({ variant = "site" }: NotFoundStageProps) {
  const title = "这一幕不在剧本里";
  const description = "页面没有找到，但你可以回到首页继续创作";
  const panelTone =
    variant === "studio"
      ? "radial-gradient(circle at 18% 14%, rgba(64, 158, 255, 0.14), transparent 46%), radial-gradient(circle at 82% 76%, rgba(15, 23, 42, 0.18), transparent 52%), linear-gradient(180deg, #0b1020 0%, #070a13 58%, #050711 100%)"
      : "radial-gradient(circle at 18% 14%, rgba(49, 95, 145, 0.16), transparent 46%), radial-gradient(circle at 82% 76%, rgba(183, 106, 29, 0.12), transparent 52%), linear-gradient(180deg, #0b1020 0%, #070a13 58%, #050711 100%)";

  return (
    <main
      className="relative isolate flex min-h-[100svh] items-center justify-center overflow-hidden px-5 py-14 text-slate-100"
      style={{
        background: panelTone,
      }}
    >
      <section className="relative w-full max-w-[560px]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-7 py-10 shadow-[0_26px_80px_rgba(0,0,0,0.46)] backdrop-blur-2xl">
          <h1 className="marketing-editorial-title text-balance text-4xl font-semibold leading-[1.04] text-slate-50 md:text-5xl">
            {title}
          </h1>
          <p className="mt-4 text-pretty text-[15px] leading-relaxed text-slate-200/80 md:text-[16px]">
            {description}
          </p>
          <div className="mt-7">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/10 px-5 py-2.5 text-sm font-semibold text-slate-50 shadow-[0_14px_30px_rgba(0,0,0,0.22)] transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              回到首页
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
