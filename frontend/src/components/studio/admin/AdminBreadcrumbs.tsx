"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface AdminBreadcrumbItem {
  label: string;
  href?: string;
}

interface AdminBreadcrumbsProps {
  items: AdminBreadcrumbItem[];
}

export default function AdminBreadcrumbs({ items }: AdminBreadcrumbsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="面包屑导航" className="admin-breadcrumbs">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const content = item.href && !isLast ? (
          <Link href={item.href} className="admin-breadcrumb-link">
            {item.label}
          </Link>
        ) : (
          <span className={isLast ? "admin-breadcrumb-current" : "admin-breadcrumb-text"}>{item.label}</span>
        );

        return (
          <span key={`${item.label}-${index}`} className="admin-breadcrumb-item">
            {content}
            {!isLast ? <ChevronRight size={14} className="admin-breadcrumb-separator" aria-hidden="true" /> : null}
          </span>
        );
      })}
    </nav>
  );
}
