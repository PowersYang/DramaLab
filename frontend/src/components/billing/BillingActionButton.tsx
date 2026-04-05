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
    <div className={clsx("relative inline-flex max-w-full", wrapperClassName)}>
      <button type={type} className={clsx("peer/billing", className)} {...props}>
        {children}
        {priceCredits != null ? (
          <span
            className={clsx(
              "billing-cost-badge inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]",
              insufficient ? "billing-cost-badge--insufficient" : "billing-cost-badge--ok",
              insufficient
                ? "border-rose-300 bg-rose-100/80 text-rose-800"
                : "border-amber-300 bg-amber-100/80 text-amber-900",
              costClassName,
            )}
          >
            <ComputeBeanIcon
              className={clsx(
                "billing-bean",
                insufficient ? "text-rose-600" : "text-amber-600",
              )}
            />
            <span className="billing-cost-value">{priceCredits}</span>
          </span>
        ) : null}
      </button>

      {resolvedTooltipText ? (
        <div
          className={clsx(
            "billing-tooltip pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white/98 px-3 py-2 text-xs font-semibold text-slate-900 opacity-0 shadow-[0_16px_32px_-18px_rgba(15,23,42,0.45)] backdrop-blur-md transition-all duration-150 peer-hover/billing:translate-y-0 peer-hover/billing:opacity-100 peer-focus/billing:translate-y-0 peer-focus/billing:opacity-100 peer-focus-visible/billing:translate-y-0 peer-focus-visible/billing:opacity-100",
            insufficient ? "billing-tooltip--insufficient" : "billing-tooltip--ok",
            tooltipClassName,
          )}
        >
          {resolvedTooltipText}
        </div>
      ) : null}
    </div>
  );
}
