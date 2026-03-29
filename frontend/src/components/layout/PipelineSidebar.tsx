"use client";

import { motion } from "framer-motion";
import {
    ChevronRight,
    ChevronLeft
} from "lucide-react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import DramaLabBranding from "./DramaLabBranding";
import type { BreadcrumbSegment } from "./BreadcrumbBar";

interface Step {
    id: string;
    label: string;
    icon: ComponentType<{ size?: string | number; className?: string }>;
}

interface PipelineSidebarProps {
    activeStep: string;
    onStepChange: (stepId: string) => void;
    steps: Step[];
    breadcrumbSegments?: BreadcrumbSegment[];
    headerActions?: ReactNode;
}

export default function PipelineSidebar({ activeStep, onStepChange, steps, breadcrumbSegments, headerActions }: PipelineSidebarProps) {
    const router = useRouter();
    const handleBack = () => {
        if (!breadcrumbSegments) return;
        const previous = breadcrumbSegments.length >= 2 ? breadcrumbSegments[breadcrumbSegments.length - 2] : breadcrumbSegments[0];
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
        <motion.aside
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="studio-sidebar w-56 flex-1 min-h-0 flex flex-col z-50"
        >
            {/* Header: breadcrumb navigation or branding */}
            <div className="p-5 border-b border-glass-border">
                {breadcrumbSegments ? (
                    <div className="space-y-3">
                        {/* Breadcrumb row */}
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={handleBack}
                                className="studio-sidebar-back flex-shrink-0 transition-colors"
                                title="返回"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <nav className="flex items-center gap-1 text-xs min-w-0 flex-1">
                                {breadcrumbSegments.map((seg, i) => {
                                    const isLast = i === breadcrumbSegments.length - 1;
                                    return (
                                        <span key={i} className="flex items-center gap-1 min-w-0">
                                            {i > 0 && <span className="studio-sidebar-crumb-separator flex-shrink-0">&rsaquo;</span>}
                                            {(seg.href || seg.hash) && !isLast ? (
                                                <a
                                                    href={seg.href || seg.hash}
                                                    className="studio-sidebar-crumb-link transition-colors truncate"
                                                >
                                                    {seg.label}
                                                </a>
                                            ) : (
                                                <span className={clsx(
                                                    "truncate",
                                                    isLast ? "studio-sidebar-crumb-current font-semibold" : "studio-sidebar-crumb-link"
                                                )}>
                                                    {seg.label}
                                                </span>
                                            )}
                                        </span>
                                    );
                                })}
                            </nav>
                        </div>
                        {/* Actions row */}
                        {headerActions && (
                            <div className="flex items-center gap-1">
                                {headerActions}
                            </div>
                        )}
                    </div>
                ) : (
                    <DramaLabBranding size="sm" />
                )}
            </div>

            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                {steps.map((step, index) => {
                    const isActive = activeStep === step.id;
                    const Icon = step.icon;

                    return (
                        <button
                            key={step.id}
                            onClick={() => onStepChange(step.id)}
                            className={clsx(
                                "studio-sidebar-step w-full flex items-center gap-2 px-2.5 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden",
                                isActive
                                    ? "studio-sidebar-step-active text-primary border border-primary/20"
                                    : "studio-sidebar-step-idle"
                            )}
                        >
                            {isActive && (
                                <motion.div
                                    layoutId="active-pill"
                                    className="absolute left-0 w-1 h-full bg-primary"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                />
                            )}

                            <div className={clsx(
                                "studio-sidebar-step-number flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                                isActive && "studio-sidebar-step-number-active"
                            )}>
                                {index + 1}
                            </div>

                            <Icon size={20} className={clsx(
                                "transition-colors",
                                isActive ? "text-primary" : "studio-sidebar-step-icon"
                            )} />

                            <div className="flex flex-col items-start text-[14px] flex-1 leading-tight min-w-0">
                                <span className="font-semibold">{step.label}</span>
                            </div>

                            {isActive && (
                                <ChevronRight size={16} className="ml-auto opacity-60" />
                            )}
                        </button>
                    );
                })}
            </nav>

        </motion.aside>
    );
}
