"use client";

import type { ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import ComputeBeanIcon from "@/components/billing/ComputeBeanIcon";

interface BillingActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  priceCredits: number | null;
  balanceCredits?: number;
  wrapperClassName?: string;
  tooltipText?: string;
  tooltipClassName?: string;
  costClassName?: string;
}

export default function BillingActionButton({
  priceCredits,
  balanceCredits = 0,
  wrapperClassName,
  tooltipText,
  tooltipClassName,
  costClassName,
  className,
  children,
  type = "button",
  ...props
}: BillingActionButtonProps) {
  const insufficient = priceCredits != null && balanceCredits < priceCredits;
  const resolvedTooltipText =
    tooltipText ??
    (priceCredits == null
      ? null
      : `预计消耗${priceCredits}算力豆${insufficient ? "，当前余额不足" : ""}`);

  return (
    <div className={clsx("group relative inline-flex max-w-full", wrapperClassName)}>
      <button type={type} className={className} {...props}>
        {children}
        {priceCredits != null ? (
          <span
            className={clsx(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]",
              insufficient
                ? "border-rose-300/80 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/12 dark:text-rose-200"
                : "border-amber-300/80 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-300/12 dark:text-amber-200",
              costClassName,
            )}
          >
            <ComputeBeanIcon
              className={clsx(
                insufficient ? "text-rose-500 dark:text-rose-300" : "text-amber-500 dark:text-amber-300",
              )}
            />
            <span>{priceCredits}</span>
          </span>
        ) : null}
      </button>

      {resolvedTooltipText ? (
        <div
          className={clsx(
            "pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 opacity-0 shadow-[0_16px_32px_-18px_rgba(15,23,42,0.45)] backdrop-blur-md transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-white/10 dark:bg-slate-950/92 dark:text-slate-100",
            tooltipClassName,
          )}
        >
          {resolvedTooltipText}
        </div>
      ) : null}
    </div>
  );
}
