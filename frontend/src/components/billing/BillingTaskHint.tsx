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
        compact ? "text-[11px]" : "text-xs",
        insufficient ? "text-rose-400" : "text-emerald-400",
        className,
      )}
    >
      {compact ? `预计 ${priceCredits} 豆` : `预计消耗 ${priceCredits} 算力豆`}
      {insufficient ? `，当前余额 ${balanceCredits} 豆不足` : ""}
    </div>
  );
}
