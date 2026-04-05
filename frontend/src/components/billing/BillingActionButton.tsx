"use client";

import type { ButtonHTMLAttributes, FocusEvent, MouseEvent } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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

type VerticalBoundary = {
  top: number;
  bottom: number;
};

function isClippingOverflow(value: string | null | undefined): boolean {
  return value === "hidden" || value === "clip" || value === "scroll" || value === "auto";
}

function resolveVerticalBoundary(element: HTMLElement): VerticalBoundary {
  if (typeof window === "undefined") {
    return { top: 0, bottom: 0 };
  }

  let boundaryTop = 0;
  let boundaryBottom = window.innerHeight || document.documentElement.clientHeight || 0;
  let current: HTMLElement | null = element.parentElement;

  // 中文注释：tooltip 实际可用空间不仅受视口影响，还会被 overflow 容器裁切，这里沿祖先链逐层收窄边界。
  while (current) {
    const styles = window.getComputedStyle(current);
    if (isClippingOverflow(styles.overflowY) || isClippingOverflow(styles.overflow)) {
      const rect = current.getBoundingClientRect();
      boundaryTop = Math.max(boundaryTop, rect.top);
      boundaryBottom = Math.min(boundaryBottom, rect.bottom);
    }
    current = current.parentElement;
  }

  return {
    top: boundaryTop,
    bottom: boundaryBottom,
  };
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
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: BillingActionButtonProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPlacement, setTooltipPlacement] = useState<"top" | "bottom">("bottom");
  const insufficient = priceCredits != null && balanceCredits < priceCredits;
  const resolvedTooltipText =
    tooltipText ??
    (priceCredits == null
      ? null
      : `预计消耗${priceCredits}算力豆${insufficient ? "，当前余额不足" : ""}`);

  // 根据按钮上下可视空间决定提示朝向，避免在弹窗底部或卡片边缘被裁切。
  const updateTooltipPlacement = useCallback(() => {
    if (!resolvedTooltipText || !wrapperRef.current || !tooltipRef.current || typeof window === "undefined") {
      return;
    }

    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const boundary = resolveVerticalBoundary(wrapperRef.current);
    const gap = 12;
    const requiredHeight = tooltipRect.height + gap;
    const spaceAbove = wrapperRect.top - boundary.top;
    const spaceBelow = boundary.bottom - wrapperRect.bottom;

    if (spaceBelow >= requiredHeight) {
      setTooltipPlacement("bottom");
      return;
    }
    if (spaceAbove >= requiredHeight) {
      setTooltipPlacement("top");
      return;
    }

    setTooltipPlacement(spaceAbove > spaceBelow ? "top" : "bottom");
  }, [resolvedTooltipText]);

  useEffect(() => {
    if (!tooltipVisible || !resolvedTooltipText || typeof window === "undefined") {
      return undefined;
    }

    updateTooltipPlacement();

    const handleViewportChange = () => {
      updateTooltipPlacement();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [resolvedTooltipText, tooltipVisible, updateTooltipPlacement]);

  const handleMouseEnter = (event: MouseEvent<HTMLDivElement | HTMLButtonElement>) => {
    setTooltipVisible(true);
    updateTooltipPlacement();
    onMouseEnter?.(event as unknown as MouseEvent<HTMLButtonElement>);
  };

  const handleMouseLeave = (event: MouseEvent<HTMLDivElement | HTMLButtonElement>) => {
    setTooltipVisible(false);
    onMouseLeave?.(event as unknown as MouseEvent<HTMLButtonElement>);
  };

  const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
    setTooltipVisible(true);
    updateTooltipPlacement();
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
    setTooltipVisible(false);
    onBlur?.(event);
  };

  return (
    <div
      ref={wrapperRef}
      data-testid="billing-action-wrapper"
      className={clsx("relative inline-flex max-w-full", wrapperClassName)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLButtonElement) {
          handleFocus(event as FocusEvent<HTMLButtonElement>);
        }
      }}
      onBlurCapture={(event) => {
        if (event.target instanceof HTMLButtonElement) {
          handleBlur(event as FocusEvent<HTMLButtonElement>);
        }
      }}
    >
      <button
        type={type}
        aria-describedby={resolvedTooltipText ? tooltipId : undefined}
        className={clsx("peer/billing", className)}
        {...props}
      >
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
          ref={tooltipRef}
          id={tooltipId}
          className={clsx(
            "billing-tooltip pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-xl border border-slate-200 bg-white/98 px-3 py-2 text-xs font-semibold text-slate-900 shadow-[0_16px_32px_-18px_rgba(15,23,42,0.45)] backdrop-blur-md transition-all duration-150",
            tooltipPlacement === "top" ? "bottom-full mb-2" : "top-full mt-2",
            tooltipPlacement === "top"
              ? tooltipVisible
                ? "-translate-y-1 opacity-100"
                : "translate-y-0 opacity-0"
              : tooltipVisible
                ? "translate-y-0 opacity-100"
                : "translate-y-1 opacity-0",
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
