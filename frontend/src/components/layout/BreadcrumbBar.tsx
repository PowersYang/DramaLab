"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export interface BreadcrumbSegment {
  label: string;
  href?: string;
  hash?: string;
}

interface BreadcrumbBarProps {
  segments: BreadcrumbSegment[];
  actions?: React.ReactNode;
}

export default function BreadcrumbBar({ segments, actions }: BreadcrumbBarProps) {
  const router = useRouter();
  const handleBack = () => {
    const previous = segments.length >= 2 ? segments[segments.length - 2] : segments[0];
    const target = previous?.href || previous?.hash;

    if (!target) {
      router.push("/");
      return;
    }

    if (target.startsWith("#")) {
      window.location.hash = target;
    } else {
      router.push(target);
    }
  };

  return (
    <div className="relative z-30 flex items-center gap-3 px-4 py-2.5 bg-gray-900/80 backdrop-blur-sm border-b border-gray-700/50">
      {/* Back arrow */}
      <button
        onClick={handleBack}
        className="flex items-center text-gray-400 hover:text-white transition-colors"
        title="返回"
      >
        <ChevronLeft size={18} />
      </button>

      {/* Breadcrumb segments */}
      <nav className="flex items-center gap-1.5 text-sm flex-1 min-w-0">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <span className="text-gray-600 flex-shrink-0">&rsaquo;</span>}
              {(seg.href || seg.hash) && !isLast ? (
                <a
                  href={seg.href || seg.hash}
                  className="text-gray-400 hover:text-white transition-colors truncate"
                >
                  {seg.label}
                </a>
              ) : (
                <span className={isLast ? "text-white font-medium truncate" : "text-gray-400 truncate"}>
                  {seg.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      {/* Right-side actions */}
      {actions && <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>}
    </div>
  );
}
