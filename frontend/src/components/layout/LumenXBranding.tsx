"use client";

interface LumenXBrandingProps {
  size?: "sm" | "md";
  showSlogan?: boolean;
}

export default function LumenXBranding({ size = "md", showSlogan = true }: LumenXBrandingProps) {
  // 统一品牌区尺寸，兼顾左侧窄栏和首页较大展示位。
  const wordSize = size === "sm" ? "text-[1.7rem]" : "text-[2.4rem]";
  const badgeSize = size === "sm" ? "text-[0.55rem]" : "text-[0.65rem]";
  const sloganSize = size === "sm" ? "text-[9px]" : "text-[10px]";

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.2),_transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.08),transparent)] opacity-60" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span
              className={`block font-display ${wordSize} font-black leading-none tracking-[-0.08em]`}
              style={{
                background: "linear-gradient(135deg, #f8fafc 0%, #fde68a 35%, #f97316 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              DramaLab
            </span>
            <span className="mt-1 block text-[0.65rem] uppercase tracking-[0.32em] text-orange-200/70">
              Story Engine
            </span>
          </div>
          <div className={`rounded-full border border-orange-300/20 bg-orange-400/10 px-2.5 py-1 font-mono font-semibold uppercase tracking-[0.25em] text-orange-100 ${badgeSize}`}>
            AI
          </div>
        </div>
      </div>
      {showSlogan && (
        <p className={`${sloganSize} text-center tracking-[0.28em] text-gray-500 uppercase`}>
          From script spark to cinematic delivery
        </p>
      )}
    </div>
  );
}
