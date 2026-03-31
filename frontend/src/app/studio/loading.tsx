export default function StudioLoading() {
  return (
    <div className="min-h-screen bg-[#f3f6fb] px-5 py-5 lg:px-8">
      <div className="mx-auto flex min-h-[220px] max-w-[1600px] items-center justify-center rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#b85c38]" />
          正在切换工作台页面...
        </div>
      </div>
    </div>
  );
}

