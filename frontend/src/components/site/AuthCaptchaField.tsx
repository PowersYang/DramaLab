"use client";

interface AuthCaptchaFieldProps {
  captchaSvg: string | null;
  captchaCode: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "default" | "compact";
}

const toCaptchaDataUrl = (svg: string) => {
  if (typeof window === "undefined") {
    return "";
  }
  return `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(svg)))}`;
};

export default function AuthCaptchaField({
  captchaSvg,
  captchaCode,
  onChange,
  onRefresh,
  disabled = false,
  loading = false,
  variant = "default",
}: AuthCaptchaFieldProps) {
  if (variant === "compact") {
    return (
      <div>
        <div className="flex min-h-[48px] overflow-hidden rounded-[1rem] border border-[#243349] bg-[#0f1724] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <input
            type="text"
            value={captchaCode}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            placeholder="输入图形验证码"
            disabled={disabled}
            className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-[14px] uppercase tracking-[0.16em] text-[#f8f4ea] outline-none placeholder:text-[#63758d] disabled:bg-[#101824] disabled:text-[#7d8ea5]"
          />
          <div className="flex w-[168px] border-l border-[#243349] bg-[#121c2a]">
            <div className="flex flex-1 items-center justify-center px-3">
              {captchaSvg ? (
                <img src={toCaptchaDataUrl(captchaSvg)} alt="图形验证码" className="h-[32px] w-full object-contain" />
              ) : (
                <span className="text-xs text-[#5f7188]">验证码加载中</span>
              )}
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={disabled || loading}
              className="w-[62px] border-l border-[#243349] px-2 text-[12px] font-semibold text-[#d9e3f2] transition-colors hover:bg-[#15263b] hover:text-[#f1d8ab] disabled:text-[#5d7188]"
            >
              {loading ? "刷新中" : "换一张"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,36,0.94),rgba(12,18,29,0.98))] px-4 py-4 text-[#f8f4ea]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[#f8f4ea]">图形验证码</div>
          <div className="mt-1 text-xs leading-5 text-[#7f91a9]">登录、注册和发送验证码前都需要先完成一次人机校验。</div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled || loading}
          className="rounded-full border border-[#365273] bg-[#101824] px-3 py-2 text-xs font-semibold text-[#d9e3f2] transition-colors hover:border-[#5f83ad] hover:text-[#f1d8ab] disabled:opacity-50"
        >
          {loading ? "刷新中..." : "换一张"}
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded-2xl border border-[#243349] bg-[#0f1724] sm:w-[170px]">
          {captchaSvg ? (
            <img src={toCaptchaDataUrl(captchaSvg)} alt="图形验证码" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-[#5f7188]">验证码加载中</span>
          )}
        </div>
        <input
          type="text"
          value={captchaCode}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          placeholder="输入图中字符"
          disabled={disabled}
          className="w-full rounded-2xl border border-[#243349] bg-[#0f1724] px-4 py-3 text-sm uppercase tracking-[0.18em] text-[#f8f4ea] outline-none transition-[border-color,box-shadow,background-color,color] placeholder:text-[#63758d] focus:border-[#47b6ff] focus:bg-[#111b2a] focus:text-[#fffaf0] focus:shadow-[0_0_0_3px_rgba(71,182,255,0.14)] disabled:bg-[#101824]"
        />
      </div>
    </div>
  );
}
