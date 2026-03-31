"use client";

import type { ReactNode } from "react";

import AdminBreadcrumbs, { type AdminBreadcrumbItem } from "@/components/studio/admin/AdminBreadcrumbs";

interface AdminPageHeaderProps {
  title: string;
  description: string;
  breadcrumbs: AdminBreadcrumbItem[];
  sectionLabel?: string;
  sectionHint?: string;
  actions?: ReactNode;
}

export default function AdminPageHeader({
  title,
  description,
  breadcrumbs,
  sectionLabel,
  sectionHint,
  actions,
}: AdminPageHeaderProps) {
  return (
    <div className="admin-page-header">
      <div className="admin-page-header-main">
        <div className="space-y-3">
          <AdminBreadcrumbs items={breadcrumbs} />
          <div className="space-y-2">
            {sectionLabel ? (
              <div className="admin-page-kicker-wrap">
                <span className="admin-page-kicker">{sectionLabel}</span>
                {sectionHint ? <span className="admin-page-kicker-hint">{sectionHint}</span> : null}
              </div>
            ) : null}
            <div>
              <h1 className="admin-page-title">{title}</h1>
              <p className="admin-page-description">{description}</p>
            </div>
          </div>
        </div>

        {actions ? <div className="admin-page-header-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
