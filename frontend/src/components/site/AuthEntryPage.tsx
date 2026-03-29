"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import MarketingShell from "@/components/site/MarketingShell";
import { useAuthStore } from "@/store/authStore";

interface AuthEntryPageProps {
  mode: "signin" | "signup";
}

const AUTH_COPY = {
  signin: {
    eyebrow: "Sign In",
    title: "邮箱验证码登录到 LumenX Studio",
    description: "已有账号直接输入邮箱登录即可。超级管理员、团队成员和受邀用户都不需要再次填写显示名称。",
    codeAction: "发送登录验证码",
    verifyAction: "验证并进入工作台",
    loadingAction: "登录中...",
    resendAction: "重新发送验证码",
    switchPrompt: "还没有账号？",
    switchAction: "去注册",
    switchHref: "/signup",
    notice: "登录即表示你同意接收与账号安全、登录提醒和工作区邀请相关的通知邮件。",
  },
  signup: {
    eyebrow: "Sign Up",
    title: "注册你的 LumenX Studio 账号",
    description: "首次注册会创建你的个人空间。显示名称只在注册时填写，用于默认个人空间名称和团队内展示。",
    codeAction: "发送注册验证码",
    verifyAction: "验证并创建账号",
    loadingAction: "注册中...",
    resendAction: "重新发送验证码",
    switchPrompt: "已经有账号？",
    switchAction: "去登录",
    switchHref: "/signin",
    notice: "注册即表示你同意接收与账号、安全验证和工作区邀请相关的通知邮件。",
  },
} as const;

export default function AuthEntryPage({ mode }: AuthEntryPageProps) {
  const searchParams = useSearchParams();
  const sendEmailCode = useAuthStore((state) => state.sendEmailCode);
  const verifyEmailCode = useAuthStore((state) => state.verifyEmailCode);

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [step, setStep] = useState<"email" | "verify">("email");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 中文注释：登录完成后优先回到原始受保护页面，注册默认进入工作台。
  const nextPath = searchParams.get("next") || "/studio";
  const isSignUp = mode === "signup";
  const copy = AUTH_COPY[mode];

  const handleSendCode = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await sendEmailCode(email, mode);
      setDebugCode(result.debug_code || null);
      setStep("verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证码发送失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // 中文注释：只有注册流程才向后端传显示名称，避免老用户登录时误触资料更新。
      await verifyEmailCode(email, code, isSignUp ? displayName || undefined : undefined, mode);
      window.location.assign(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : isSignUp ? "注册失败" : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MarketingShell ctaMode="auth">
      <section className="mx-auto flex min-h-[70vh] max-w-7xl items-center px-6 py-16 lg:px-10">
        <div className="grid w-full gap-10 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="studio-panel p-10">
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-sm font-semibold text-slate-500">
              <Link
                href="/signin"
                className={`rounded-full px-4 py-2 transition-colors ${!isSignUp ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950"}`}
              >
                登录
              </Link>
              <Link
                href="/signup"
                className={`rounded-full px-4 py-2 transition-colors ${isSignUp ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950"}`}
              >
                注册
              </Link>
            </div>

            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.24em] text-primary">{copy.eyebrow}</p>
            <h1 className="mt-4 text-4xl font-bold text-slate-950">{copy.title}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">{copy.description}</p>
            <div className="mt-6 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              手机号验证码登录已在数据结构中预留，后续会接入短信能力。
            </div>
          </div>

          <div className="studio-panel p-10">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@studio.com"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary/50"
                />
              </label>

              {isSignUp ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">显示名称</span>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="例如：Will，首次注册时会用于创建个人空间"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary/50"
                  />
                </label>
              ) : null}

              {step === "verify" ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">验证码</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="输入 6 位验证码"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm tracking-[0.28em] text-slate-900 outline-none transition-colors focus:border-primary/50"
                  />
                </label>
              ) : null}

              {debugCode ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  当前环境开启了调试验证码回显：<span className="font-semibold">{debugCode}</span>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                {step === "email" ? (
                  <button
                    disabled={!email.trim() || (isSignUp && !displayName.trim()) || submitting}
                    onClick={() => void handleSendCode()}
                    className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {submitting ? "发送中..." : copy.codeAction}
                  </button>
                ) : (
                  <>
                    <button
                      disabled={!email.trim() || !code.trim() || (isSignUp && !displayName.trim()) || submitting}
                      onClick={() => void handleVerify()}
                      className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {submitting ? copy.loadingAction : copy.verifyAction}
                    </button>
                    <button
                      disabled={submitting}
                      onClick={() => void handleSendCode()}
                      className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700"
                    >
                      {copy.resendAction}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="mt-8 text-sm text-slate-500">{copy.notice}</div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-slate-500">{copy.switchPrompt}</span>
              <Link href={copy.switchHref} className="font-semibold text-primary">
                {copy.switchAction}
              </Link>
              <Link href="/" className="font-semibold text-slate-600">
                返回官网
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
