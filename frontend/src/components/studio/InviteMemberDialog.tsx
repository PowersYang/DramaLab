"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MailPlus, Copy, Check } from "lucide-react";

import { api, type InvitationCreateResponse } from "@/lib/api";

interface InviteMemberDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const ROLE_OPTIONS = [
  { code: "org_admin", label: "管理员", note: "管理成员、计费与配置" },
  { code: "producer", label: "制作人员", note: "负责项目、资产与分镜生成" },
];

export default function InviteMemberDialog({ isOpen, onClose, onSuccess }: InviteMemberDialogProps) {
  const [email, setEmail] = useState("");
  const [roleCode, setRoleCode] = useState("producer");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const handleInvite = async () => {
    if (!email.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await api.inviteWorkspaceMember(email.trim(), roleCode);
      setInvitation(result);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送邀请失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.invite_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleClose = () => {
    setEmail("");
    setRoleCode("producer");
    setError(null);
    setInvitation(null);
    setCopied(false);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-6 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="w-full max-w-xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-8 py-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <MailPlus size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-950">邀请新成员</h2>
                  <p className="text-xs text-slate-500">邀请伙伴加入当前工作区共同创作</p>
                </div>
              </div>
              <button onClick={handleClose} className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-950">
                <X size={18} />
              </button>
            </div>

            <div className="p-8">
              {!invitation ? (
                <div className="space-y-6">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">受邀人邮箱</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="team@company.com"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary focus:bg-white"
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="mb-3 block text-sm font-semibold text-slate-700">分配角色</label>
                    <div className="grid gap-3">
                      {ROLE_OPTIONS.map((role) => (
                        <button
                          key={role.code}
                          type="button"
                          onClick={() => setRoleCode(role.code)}
                          className={`flex items-start gap-4 rounded-2xl border p-4 text-left transition-all ${
                            roleCode === role.code
                              ? "border-primary/40 bg-primary/5 ring-1 ring-primary/40"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className={`mt-1 h-4 w-4 rounded-full border-2 ${
                            roleCode === role.code ? "border-primary bg-primary" : "border-slate-300"
                          }`}>
                            {roleCode === role.code && (
                              <div className="mx-auto mt-0.5 h-1.5 w-1.5 rounded-full bg-white" />
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-900">{role.label}</div>
                            <div className="mt-1 text-xs text-slate-500">{role.note}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  )}

                  <div className="flex justify-end gap-3 pt-4">
                    <button onClick={handleClose} className="rounded-full border border-slate-200 px-6 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">
                      取消
                    </button>
                    <button
                      onClick={handleInvite}
                      disabled={!email.trim() || isSubmitting}
                      className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:bg-secondary hover:shadow-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSubmitting ? "发送中..." : "发送邀请"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-6 text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                      <Check size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">邀请已成功创建</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      系统已向 <span className="font-semibold text-slate-900">{invitation.email}</span> 发送了邀请邮件。
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">邀请链接</label>
                    <div className="flex gap-2">
                      <div className="flex-1 truncate rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                        {invitation.invite_url}
                      </div>
                      <button
                        onClick={handleCopy}
                        className={`flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition-all ${
                          copied ? "bg-emerald-500 text-white" : "bg-slate-900 text-white hover:bg-slate-800"
                        }`}
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? "已复制" : "复制"}
                      </button>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      如果对方未收到邮件，你可以直接复制上方链接通过即时通讯工具（如微信、飞书）发送给对方。
                    </p>
                  </div>

                  <div className="flex justify-center pt-4">
                    <button onClick={handleClose} className="rounded-full bg-slate-100 px-10 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200">
                      完成
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
