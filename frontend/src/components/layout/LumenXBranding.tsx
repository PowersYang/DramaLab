"use client";

interface LumenXBrandingProps {
  size?: "sm" | "md";
  showSlogan?: boolean;
}

export default function LumenXBranding({ size = "md", showSlogan = true }: LumenXBrandingProps) {
  // 商业化品牌区改为纯文字字标，避免图形符号带来的冗余感。
  const wordSize = size === "sm" ? "text-[1.6rem]" : "text-[2.2rem]";
  const sloganSize = size === "sm" ? "text-[9px]" : "text-[10px]";

  return (
    <div className="space-y-2">
      <div className="min-w-0">
        <span className={`block font-display ${wordSize} font-semibold leading-none tracking-[-0.05em] text-slate-950`}>
          DramaLab
        </span>
      </div>

      {showSlogan && (
        <p className={`${sloganSize} tracking-[0.22em] text-slate-500 uppercase`}>
          Commercial storytelling studio
        </p>
      )}
    </div>
  );
}
