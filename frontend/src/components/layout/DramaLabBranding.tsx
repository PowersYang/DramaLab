"use client";

interface DramaLabBrandingProps {
  size?: "sm" | "md";
  showSlogan?: boolean;
  tone?: "light" | "dark";
}

export default function DramaLabBranding({ size = "md", showSlogan = true, tone = "dark" }: DramaLabBrandingProps) {
  const wordSize = size === "sm" ? "text-[1.6rem]" : "text-[2.2rem]";
  const sloganSize = size === "sm" ? "text-[9px]" : "text-[10px]";
  const titleTone = tone === "light" ? "text-white" : "text-slate-950";
  const sloganTone = tone === "light" ? "text-white/55" : "text-slate-500";

  return (
    <div className="space-y-2">
      <div className="min-w-0">
        <span className={`block font-display ${wordSize} font-semibold leading-none tracking-[-0.05em] ${titleTone}`}>
          DramaLab
        </span>
      </div>

      {showSlogan && (
        <p className={`${sloganSize} ${sloganTone} tracking-[0.22em] uppercase`}>
          Commercial storytelling studio
        </p>
      )}
    </div>
  );
}
