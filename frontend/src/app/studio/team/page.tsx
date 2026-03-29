"use client";

import { useEffect, useState } from "react";

import StudioShell from "@/components/studio/StudioShell";
import { api, type MembershipWithRole } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

const ROLE_OPTIONS = [
  { code: "org_admin", label: "组织管理员" },
  { code: "producer", label: "制作人员" },
];

export default function StudioTeamRoutePage() {
  const me = useAuthStore((state) => state.me);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const canManageMembers = hasCapability("workspace.manage_members");

  const [members, setMembers] = useState<MembershipWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleCode, setInviteRoleCode] = useState("producer");
  const [error, setError] = useState<string | null>(null);

  const loadMembers = async () => {
    setLoading(true);
    try {
      setError(null);
      const result = await api.listWorkspaceMembers();
      setMembers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "团队成员加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMembers();
  }, []);

  if (!canManageMembers && me?.current_role_code !== "producer") {
    return (
      <StudioShell title="团队与角色" description="根据当前角色展示团队协作与权限边界。">
        <section className="studio-panel p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Team</p>
          <h2 className="mt-4 text-3xl font-bold text-slate-950">个人空间当前不开放团队管理</h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
            个人用户会自动拥有自己的默认工作区。后续如果需要协作，可以升级到企业工作区或接受 MCN / 短剧公司的邀请。
          </p>
        </section>
      </StudioShell>
    );
  }

  return (
    <StudioShell title="团队与角色" description="按工作区角色管理成员、邀请协作者，并控制制作权限边界。">
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="studio-panel p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Invite</p>
          <h2 className="mt-4 text-2xl font-bold text-slate-950">邀请成员加入当前工作区</h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            被邀请成员会使用受邀邮箱通过验证码完成加入，不需要单独注册企业成员身份。手机号登录已预留，后续会补短信验证码链路。
          </p>

          {canManageMembers ? (
            <div className="mt-6 space-y-4">
              <input
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="team@company.com"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
              />
              <select
                value={inviteRoleCode}
                onChange={(event) => setInviteRoleCode(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.label}
                  </option>
                ))}
              </select>
              <button
                disabled={!inviteEmail.trim()}
                onClick={async () => {
                  try {
                    setError(null);
                    await api.inviteWorkspaceMember(inviteEmail, inviteRoleCode);
                    setInviteEmail("");
                    await loadMembers();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "邀请发送失败");
                  }
                }}
                className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                发送邀请
              </button>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              你当前是制作人员，可查看团队成员，但不能邀请或修改角色。
            </div>
          )}
        </section>

        <section className="studio-panel p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Members</p>
              <h2 className="mt-3 text-2xl font-bold text-slate-950">当前工作区成员</h2>
            </div>
            <button onClick={() => void loadMembers()} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              刷新
            </button>
          </div>

          {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          <div className="mt-6 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">正在加载成员列表...</div>
            ) : members.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">当前工作区还没有成员。</div>
            ) : (
              members.map((member) => (
                <div key={member.membership_id} className="flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{member.display_name || member.email || member.user_id}</p>
                    <p className="mt-1 text-xs text-slate-500">{member.email || "未配置邮箱"} · {member.workspace_name || "工作区"}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    {canManageMembers ? (
                      <select
                        value={member.role_code || "producer"}
                        onChange={async (event) => {
                          try {
                            await api.updateWorkspaceMemberRole(member.membership_id, event.target.value);
                            await loadMembers();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "角色更新失败");
                          }
                        }}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role.code} value={role.code}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                        {member.role_name || member.role_code || "成员"}
                      </div>
                    )}
                    {canManageMembers ? (
                      <button
                        onClick={async () => {
                          try {
                            await api.deleteWorkspaceMember(member.membership_id);
                            await loadMembers();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "成员移除失败");
                          }
                        }}
                        className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600"
                      >
                        移除
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </StudioShell>
  );
}
