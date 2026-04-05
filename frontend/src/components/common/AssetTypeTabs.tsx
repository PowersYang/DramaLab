"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { motion } from "framer-motion";

type AssetTypeTabsItem<T extends string> = {
  id: T;
  label: string;
  icon: ReactNode;
  count?: number;
  disabled?: boolean;
};

export default function AssetTypeTabs<T extends string>({
  items,
  value,
  onChange,
  layoutIdPrefix = "asset-type-tabs",
  className,
  buttonClassName,
}: {
  items: Array<AssetTypeTabsItem<T>>;
  value: T;
  onChange: (next: T) => void;
  layoutIdPrefix?: string;
  className?: string;
  buttonClassName?: string;
}) {
  const layoutId = `${layoutIdPrefix}-activeTabGlow`;

  return (
    <div className={clsx("flex items-center gap-1 rounded-xl p-1", className)}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            aria-pressed={active}
            disabled={item.disabled}
            className={clsx(
              "group relative inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "bg-[color:var(--studio-surface-20)] text-[color:var(--studio-shell-accent-strong)] shadow-sm ring-1 ring-[color:var(--studio-shell-accent-soft)]"
                : "text-[color:var(--studio-text-muted)] hover:bg-[color:var(--studio-surface-10)] hover:text-[color:var(--studio-text-strong)]",
              buttonClassName
            )}
          >
            <div
              className={clsx(
                "transition-colors",
                active
                  ? "text-[color:var(--studio-shell-accent)]"
                  : "text-[color:var(--studio-text-faint)] group-hover:text-[color:var(--studio-text-muted)]"
              )}
            >
              {item.icon}
            </div>
            <span className="font-semibold tracking-tight">{item.label}</span>
            {typeof item.count === "number" ? (
              <span
                className={clsx(
                  "ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
                  active
                    ? "bg-[color:var(--studio-shell-accent-soft)] text-[color:var(--studio-shell-accent-strong)]"
                    : "bg-[color:var(--studio-surface-10)] text-[color:var(--studio-text-faint)] group-hover:text-[color:var(--studio-text-muted)]"
                )}
              >
                {item.count}
              </span>
            ) : null}

            {active ? (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-lg bg-[color:var(--studio-shell-accent-subtle)]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

