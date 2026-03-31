"use client";

import type { LucideIcon } from "lucide-react";

interface AdminSummaryItem {
  label: string;
  value: string | number;
  note?: string;
  icon?: LucideIcon;
}

interface AdminSummaryStripProps {
  items: AdminSummaryItem[];
}

export default function AdminSummaryStrip({ items }: AdminSummaryStripProps) {
  return (
    <div className="admin-summary-strip">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="admin-summary-card">
            <div className="admin-summary-head">
              <div className="admin-summary-label">{item.label}</div>
              {Icon ? (
                <span className="admin-summary-icon">
                  <Icon size={16} />
                </span>
              ) : null}
            </div>
            <div className="admin-summary-value">{item.value}</div>
            {item.note && <p className="admin-summary-note">{item.note}</p>}
          </div>
        );
      })}
    </div>
  );
}
