"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, MailPlus, RefreshCw, Search, Trash2, Users2, Clock, X } from "lucide-react";

import { api, type MembershipWithRole, type InvitationCreateResponse } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import InviteMemberDialog from "@/components/studio/InviteMemberDialog";

const ROLE_OPTIONS = [
  { code: "org_admin", label: "组织管理员" },
  { code: "producer", label: "制作人员" },
];

export default function StudioTeamRoutePage() {
  const me = useAuthStore((state) => state.me);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const canManageMembers = hasCapability("workspace.manage_members");

  const [members, setMembers] = useState<MembershipWithRole[]>([]);
  const [invitations, setInvitations] = useState<InvitationCreateResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      setError(null);
      const [membersResult, invitationsResult] = await Promise.all([
        api.listWorkspaceMembers(),
        api.listWorkspaceInvitations(),
      ]);
      setMembers(membersResult);
      setInvitations(invitationsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "团队信息加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredMembers = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return members;
    return members.filter((member) =>
      [member.display_name || "", member.email || "", member.role_name || "", member.workspace_name || ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedKeyword),
    );
  }, [keyword, members]);

  const summaryItems = useMemo(
    () => [
      { label: "总成员数", value: members.length, note: "当前工作区全部可见成员", icon: Users2 },
      {
        label: "待处理邀请",
        value: invitations.length,
        note: "已发送但尚未接受的邀请",
        icon: Clock,
      },
      {
        label: "制作人员数",
        value: members.filter((item) => item.role_code === "producer").length,
        note: "负责项目、资产、分镜和生成任务",
        icon: MailPlus,
      },
    ],
    [members, invitations],
  );

  if (!canManageMembers && me?.current_role_code !== "producer") {
    return (
      <section className="studio-panel p-8">
        <p className="admin-block-kicker">Team</p>
        <h2 className="mt-4 text-3xl font-bold text-slate-950">个人空间当前不开放团队管理</h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
          个人用户会自动拥有自己的默认工作区。后续如果需要协作，可以升级到企业工作区或接受 MCN / 短剧公司的邀请。
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-1 md:grid-cols-4">
        {summaryItems.map((item) => (
          <div key={item.label} className="admin-summary-card flex flex-col justify-between">
            <div>
              <div className="admin-summary-head">
                <div className="admin-summary-label">{item.label}</div>
                <span className="admin-summary-icon">
                  <item.icon size={16} />
                </span>
              </div>
              <div className="admin-summary-value">{item.value}</div>
            </div>
            <p className="admin-summary-note mt-2">{item.note}</p>
          </div>
        ))}

        <div className="admin-summary-card flex flex-col justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MailPlus size={20} />
            </div>
            <div className="text-center">
              <h3 className="text-sm font-bold text-slate-900">扩充你的团队</h3>
              <p className="mt-0.5 text-[10px] text-slate-500">邀请新成员加入工作区协作</p>
            </div>
            {canManageMembers ? (
              <button
                onClick={() => setInviteDialogOpen(true)}
                className="studio-button studio-button-primary w-full !min-h-[2rem] !text-xs"
              >
                <MailPlus size={14} />
                邀请新成员
              </button>
            ) : (
              <p className="text-[10px] text-slate-400">无管理权限</p>
            )}
          </div>
        </div>
      </div>

      <InviteMemberDialog
        isOpen={inviteDialogOpen}
        onClose={() => setInviteDialogOpen(false)}
        onSuccess={() => void loadData()}
      />

      {invitations.length > 0 && (
        <section className="studio-panel overflow-hidden">
          <div className="admin-ledger-head">
            <div>
              <h2 className="text-xl font-bold text-slate-950">待处理邀请</h2>
              <p className="mt-1 text-sm text-slate-500">这些邀请已发出，正在等待对方接受。</p>
            </div>
          </div>
          <div className="admin-governance-table border-0 rounded-none">
            <table className="bg-white text-sm">
              <thead>
                <tr>
                  <th>受邀邮箱</th>
                  <th>分配角色</th>
                  <th>有效期至</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invite) => (
                  <tr key={invite.id}>
                    <td className="font-semibold text-slate-900">{invite.email}</td>
                    <td>
                      <span className="admin-status-badge admin-status-badge-neutral">
                        {ROLE_OPTIONS.find(r => r.code === invite.role_code)?.label || invite.role_code}
                      </span>
                    </td>
                    <td className="text-slate-500">
                      {new Date(invite.expires_at).toLocaleString("zh-CN")}
                    </td>
                    <td>
                      <div className="flex justify-end">
                        <button
                          onClick={async () => {
                            if (!confirm(`确定要撤销对 ${invite.email} 的邀请吗？`)) return;
                            try {
                              await api.deleteWorkspaceInvitation(invite.id);
                              await loadData();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "撤销邀请失败");
                            }
                          }}
                          className="studio-button studio-button-secondary !min-h-[2.25rem] !px-3 !text-rose-600 hover:!bg-rose-50 hover:!border-rose-100"
                        >
                          <X size={14} />
                          撤销邀请
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="studio-panel overflow-hidden">
        <div className="admin-ledger-head">
          <div>
            <h2 className="text-xl font-bold text-slate-950">当前工作区成员</h2>
            <p className="mt-1 text-sm text-slate-500">按后台台账管理成员身份、角色与协作边界。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="admin-filter-search">
              <Search size={16} className="admin-filter-search-icon" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索成员、邮箱或角色"
                className="admin-filter-search-input"
              />
            </label>
            <button onClick={() => void loadData()} className="studio-button studio-button-secondary">
              <RefreshCw size={16} />
              刷新
            </button>
          </div>
        </div>

        {error ? <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="admin-governance-table border-0 rounded-none">
          <table className="bg-white text-sm">
            <thead>
              <tr>
                <th>成员</th>
                <th>邮箱 / 工作区</th>
                <th>角色</th>
                <th>状态</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">正在加载成员列表...</td>
                </tr>
              ) : filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">当前筛选条件下没有成员。</td>
                </tr>
              ) : (
                filteredMembers.map((member) => (
                  <tr key={member.membership_id}>
                    <td className="font-semibold text-slate-900">{member.display_name || member.email || member.user_id}</td>
                    <td className="text-slate-700">{member.email || "未配置邮箱"} · {member.workspace_name || "工作区"}</td>
                    <td>
                      {canManageMembers ? (
                        <select
                          value={member.role_code || "producer"}
                          onChange={async (event) => {
                            try {
                              await api.updateWorkspaceMemberRole(member.membership_id, event.target.value);
                              await loadData();
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
                        <span className="admin-status-badge admin-status-badge-neutral">{member.role_name || member.role_code || "成员"}</span>
                      )}
                    </td>
                    <td><span className="admin-status-badge admin-status-badge-neutral">{member.status}</span></td>
                    <td>
                      <div className="flex justify-end">
                        {canManageMembers ? (
                          <button
                            onClick={async () => {
                              if (!confirm(`确定要移除成员 ${member.display_name || member.email} 吗？`)) return;
                              try {
                                await api.deleteWorkspaceMember(member.membership_id);
                                await loadData();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : "成员移除失败");
                              }
                            }}
                            className="studio-button studio-button-danger !min-h-[2.25rem] !px-3"
                          >
                            <Trash2 size={14} />
                            移除
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
