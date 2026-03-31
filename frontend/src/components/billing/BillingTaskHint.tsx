"use client";

import clsx from "clsx";

interface BillingTaskHintProps {
  priceCredits: number | null;
  balanceCredits?: number;
  compact?: boolean;
  className?: string;
}

export default function BillingTaskHint({
  priceCredits,
  balanceCredits = 0,
  compact = false,
  className,
}: BillingTaskHintProps) {
  if (priceCredits == null) {
    return null;
  }

  const insufficient = balanceCredits < priceCredits;

  return (
    <div
      className={clsx(
        "inline-flex items-center rounded-full border px-3 py-1.5 font-medium tracking-[0.01em] shadow-sm backdrop-blur-sm",
        compact ? "text-[11px]" : "text-xs sm:text-sm",
        insufficient
          ? "border-rose-200/80 bg-rose-50/90 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
          : "border-slate-300/80 bg-white/90 text-slate-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
        className,
      )}
    >
      {`消耗${priceCredits}算力豆`}
      {insufficient ? `，当前余额 ${balanceCredits} 个算力豆不足` : ""}
    </div>
  );
}
