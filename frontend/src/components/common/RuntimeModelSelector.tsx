"use client";

import type { SimpleModelOption } from "@/lib/modelCatalog";

interface RuntimeModelSelectorProps {
  label: string;
  value: string;
  options: SimpleModelOption[];
  onChange?: (modelId: string) => void;
  sourceHint?: string;
  helperText?: string;
  disabled?: boolean;
}

export default function RuntimeModelSelector({
  label,
  value,
  options,
  onChange,
  sourceHint,
  helperText,
  disabled = false,
}: RuntimeModelSelectorProps) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">{label}</div>
          {sourceHint ? <p className="mt-2 text-xs leading-5 text-gray-500">{sourceHint}</p> : null}
        </div>
      </div>

      <div className="mt-4">
        <select
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          disabled={disabled}
          className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-gray-100 outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/5 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id} disabled={option.disabled}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      {helperText ? <p className="mt-3 text-xs leading-5 text-gray-400">{helperText}</p> : null}
    </div>
  );
}
