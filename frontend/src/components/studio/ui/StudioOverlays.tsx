"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

type ToastTone = "info" | "success" | "warning" | "error";

type ToastItem = {
  id: string;
  title?: string;
  message: string;
  tone: ToastTone;
  ttlMs: number;
};

type ConfirmTone = "default" | "danger";

type ConfirmOptions = {
  title: string;
  message: string;
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
};

type StudioToastApi = {
  info: (message: string, title?: string) => void;
  success: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
};

type StudioConfirmApi = (options: ConfirmOptions) => Promise<boolean>;

const ToastContext = createContext<StudioToastApi | null>(null);
const ConfirmContext = createContext<StudioConfirmApi | null>(null);

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

export function useStudioToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useStudioToast must be used within StudioOverlaysProvider");
  }
  return ctx;
}

export function useStudioConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useStudioConfirm must be used within StudioOverlaysProvider");
  }
  return ctx;
}

export function StudioOverlaysProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<
    | (ConfirmOptions & {
        open: true;
        resolve: (v: boolean) => void;
      })
    | { open: false }
  >({ open: false });

  const toastApi = useMemo<StudioToastApi>(() => {
    const push = (tone: ToastTone, message: string, title?: string) => {
      const id = uid("toast");
      const ttlMs = tone === "error" ? 6000 : 3800;
      const item: ToastItem = { id, tone, message, title, ttlMs };
      setToasts((prev) => [item, ...prev].slice(0, 4));
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, ttlMs);
    };
    return {
      info: (m, t) => push("info", m, t),
      success: (m, t) => push("success", m, t),
      warning: (m, t) => push("warning", m, t),
      error: (m, t) => push("error", m, t),
    };
  }, []);

  const confirmApi = useCallback<StudioConfirmApi>((options) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...options, open: true, resolve });
    });
  }, []);

  const closeConfirm = useCallback(
    (result: boolean) => {
      setConfirmState((prev) => {
        if (!prev.open) {
          return prev;
        }
        prev.resolve(result);
        return { open: false };
      });
    },
    [setConfirmState]
  );

  return (
    <ToastContext.Provider value={toastApi}>
      <ConfirmContext.Provider value={confirmApi}>
        {children}
        <div className="pointer-events-none fixed inset-0 z-[80]">
          <div className="pointer-events-none absolute top-5 right-5 flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col gap-2">
            {toasts.map((t) => (
              <StudioToast key={t.id} item={t} onDismiss={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
            ))}
          </div>
        </div>
        {confirmState.open && (
          <StudioConfirmDialog
            title={confirmState.title}
            message={confirmState.message}
            tone={confirmState.tone}
            confirmLabel={confirmState.confirmLabel}
            cancelLabel={confirmState.cancelLabel}
            onClose={closeConfirm}
          />
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

function StudioToast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const tone = item.tone;
  const toneStyles =
    tone === "success"
      ? "border-[color:var(--video-workspace-success-soft)]"
      : tone === "warning"
      ? "border-[color:var(--video-workspace-warning-soft)]"
      : tone === "error"
      ? "border-[color:var(--video-workspace-danger-soft)]"
      : "border-[color:var(--video-workspace-accent-ring)]";

  const pillStyles =
    tone === "success"
      ? "bg-[color:var(--video-workspace-success-soft)] text-[color:var(--studio-text-soft)]"
      : tone === "warning"
      ? "bg-[color:var(--video-workspace-warning-soft)] text-[color:var(--studio-text-soft)]"
      : tone === "error"
      ? "bg-[color:var(--video-workspace-danger-soft)] text-[color:var(--studio-text-soft)]"
      : "bg-[color:var(--video-workspace-accent-soft)] text-[color:var(--studio-text-soft)]";

  const label = tone === "success" ? "完成" : tone === "warning" ? "提示" : tone === "error" ? "失败" : "信息";

  return (
    <div className="pointer-events-auto">
      <div
        className={[
          "relative overflow-hidden rounded-2xl border shadow-[var(--video-workspace-shadow-soft)] backdrop-blur-md",
          "bg-[color:var(--video-workspace-panel-strong)]",
          toneStyles,
        ].join(" ")}
      >
        <div className="flex gap-3 p-3">
          <div className={["mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11px] font-semibold", pillStyles].join(" ")}>
            {label}
          </div>
          <div className="min-w-0 flex-1">
            {item.title && <div className="text-sm font-semibold text-[color:var(--studio-text-strong)]">{item.title}</div>}
            <div className="mt-0.5 text-sm text-[color:var(--studio-text-soft)]">{item.message}</div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-[color:var(--studio-text-faint)] transition-colors hover:bg-white/10 hover:text-[color:var(--studio-text-strong)]"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function StudioConfirmDialog({
  title,
  message,
  tone = "default",
  confirmLabel,
  cancelLabel,
  onClose,
}: {
  title: string;
  message: string;
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
  onClose: (result: boolean) => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const primaryClass =
    tone === "danger"
      ? "bg-[color:color-mix(in_srgb,var(--video-workspace-danger-soft)_65%,#b43838)] text-white hover:brightness-110"
      : "bg-[color:var(--video-workspace-accent)] text-white hover:brightness-110";

  const confirmText = confirmLabel ?? (tone === "danger" ? "继续" : "确认");
  const cancelText = cancelLabel ?? "取消";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-10">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onMouseDown={() => onClose(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-[520px] max-w-full overflow-hidden rounded-3xl border border-[color:var(--video-workspace-border-strong)] bg-[color:var(--video-workspace-panel-strong)] shadow-[var(--video-workspace-shadow)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--video-workspace-border)] px-5 py-4">
          <div className="min-w-0">
            <div className="text-base font-semibold text-[color:var(--studio-text-strong)]">{title}</div>
            <div className="mt-1 text-sm text-[color:var(--studio-text-soft)]">{message}</div>
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-2xl text-[color:var(--studio-text-faint)] transition-colors hover:bg-white/10 hover:text-[color:var(--studio-text-strong)]"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="inline-flex h-10 items-center justify-center rounded-2xl border border-[color:var(--video-workspace-border)] bg-white/5 px-4 text-sm font-semibold text-[color:var(--studio-text-soft)] transition-colors hover:bg-white/10"
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onClose(true)}
            className={["inline-flex h-10 items-center justify-center rounded-2xl px-5 text-sm font-semibold transition-all active:scale-[0.98]", primaryClass].join(" ")}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

