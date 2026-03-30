"use client";

interface AuthCaptchaFieldProps {
  captchaSvg: string | null;
  captchaCode: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
  disabled?: boolean;
  loading?: boolean;
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
}: AuthCaptchaFieldProps) {
  return (
    <div className="space-y-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">图形验证码</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">登录、注册和发送验证码前都需要先完成一次人机校验。</div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled || loading}
          className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
        >
          {loading ? "刷新中..." : "换一张"}
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white sm:w-[170px]">
          {captchaSvg ? (
            <img src={toCaptchaDataUrl(captchaSvg)} alt="图形验证码" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-slate-400">验证码加载中</span>
          )}
        </div>
        <input
          type="text"
          value={captchaCode}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          placeholder="输入图中字符"
          disabled={disabled}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm uppercase tracking-[0.18em] text-slate-900 outline-none transition-colors focus:border-primary/50 disabled:bg-slate-50"
        />
      </div>
    </div>
  );
}
