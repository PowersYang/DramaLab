"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import MarketingShell from "@/components/site/MarketingShell";
import { api, type InvitationPreview } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

interface AcceptInvitePageProps {
  invitationId: string;
}

const formatExpiry = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN");
};

export default function AcceptInvitePage({ invitationId }: AcceptInvitePageProps) {
  const router = useRouter();
  const sendEmailCode = useAuthStore((state) => state.sendEmailCode);
  const verifyEmailCode = useAuthStore((state) => state.verifyEmailCode);

  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [step, setStep] = useState<"loading" | "ready" | "verify">("loading");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setError(null);
        const result = await api.getInvitationPreview(invitationId);
        if (cancelled) return;
        setInvitation(result);
        setStep("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "邀请信息加载失败");
        setStep("ready");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  const handleSendCode = async () => {
    if (!invitation) return;
    setSubmitting(true);
    setError(null);
    setInfoMessage(null);
    try {
      const result = await sendEmailCode(invitation.email, "invite_accept");
      setDebugCode(result.debug_code || null);
      setStep("verify");
      setInfoMessage("验证码已发送到受邀邮箱，请在下方输入后完成加入。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证码发送失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAccept = async () => {
    if (!invitation) return;
    setSubmitting(true);
    setError(null);
    try {
      await verifyEmailCode(invitation.email, code, {
        purpose: "invite_accept",
        displayName: displayName || undefined,
        invitationId: invitation.id,
      });
      router.replace("/studio");
    } catch (err) {
      setError(err instanceof Error ? err.message : "接受邀请失败");
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = !invitation || invitation.accepted_at || invitation.is_expired;

  return (
    <MarketingShell ctaMode="auth">
      <section className="mx-auto flex min-h-[70vh] max-w-5xl items-center px-6 py-16 lg:px-10">
        <div className="grid w-full gap-8 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="studio-panel p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Invite</p>
            <h1 className="mt-4 text-4xl font-bold text-slate-950">加入 DramaLab 团队工作区</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
              通过邀请链接确认组织和工作区信息后，使用受邀邮箱完成验证码验证，即可进入团队工作台。
            </p>

            {invitation && !invitation.accepted_at && !invitation.is_expired ? (
              <div className="mt-6 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold tracking-[0.18em] text-emerald-700">
                邀请有效
              </div>
            ) : null}

            <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-5 text-sm text-slate-600">
              {step === "loading" ? "正在加载邀请信息..." : null}
              {step !== "loading" && !invitation ? "当前邀请不存在、已失效，或已被使用。" : null}
              {invitation ? (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">组织</div>
                    <div className="mt-1 font-semibold text-slate-900">{invitation.organization_name || invitation.organization_id}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">工作区</div>
                    <div className="mt-1 font-semibold text-slate-900">{invitation.workspace_name || invitation.workspace_id}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">角色</div>
                    <div className="mt-1 font-semibold text-slate-900">{invitation.role_name || invitation.role_code}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">受邀邮箱</div>
                    <div className="mt-1 font-semibold text-slate-900">{invitation.email}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">有效期</div>
                    <div className="mt-1 font-semibold text-slate-900">{formatExpiry(invitation.expires_at)}</div>
                  </div>
                </div>
              ) : null}
            </div>

            {invitation?.accepted_at ? (
              <div className="mt-5 rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
                这条邀请已经被接受，你可以直接前往登录页继续登录。
              </div>
            ) : null}
            {invitation?.is_expired ? (
              <div className="mt-5 rounded-[1.5rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
                这条邀请已过期，请联系管理员重新发送。
              </div>
            ) : null}
          </div>

          <div className="studio-panel p-10">
            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
                <div className="font-semibold text-slate-900">加入步骤</div>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>确认这是你要加入的组织和工作区</li>
                  <li>使用受邀邮箱发送验证码</li>
                  <li>输入验证码后完成加入并进入工作台</li>
                </ol>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">显示名称</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="例如：小林制片"
                  disabled={disabled}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary/50 disabled:bg-slate-50"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">邮箱</span>
                <input
                  type="email"
                  value={invitation?.email || ""}
                  disabled
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 outline-none"
                />
              </label>

              {step === "verify" ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">验证码</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    disabled={disabled}
                    placeholder="输入 6 位验证码"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm tracking-[0.28em] text-slate-900 outline-none transition-colors focus:border-primary/50 disabled:bg-slate-50"
                  />
                </label>
              ) : null}

              {debugCode ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  当前环境开启了调试验证码回显：<span className="font-semibold">{debugCode}</span>
                </div>
              ) : null}
              {infoMessage ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{infoMessage}</div> : null}
              {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

              <div className="flex flex-wrap gap-3 pt-2">
                {step !== "verify" ? (
                  <button
                    disabled={disabled || submitting}
                    onClick={() => void handleSendCode()}
                    className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {submitting ? "发送中..." : "发送验证码"}
                  </button>
                ) : (
                  <>
                    <button
                      disabled={disabled || !code.trim() || submitting}
                      onClick={() => void handleAccept()}
                      className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {submitting ? "加入中..." : "确认加入团队"}
                    </button>
                    <button
                      disabled={disabled || submitting}
                      onClick={() => void handleSendCode()}
                      className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700"
                    >
                      重新发送验证码
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
              <Link href="/signin" className="font-semibold text-primary">
                返回登录
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
