"""认证、会话与工作区权限服务。"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import smtplib
import uuid
from base64 import urlsafe_b64decode, urlsafe_b64encode
from dataclasses import dataclass
from datetime import timedelta, timezone
from email.message import EmailMessage

from ...auth.constants import (
    ROLE_CAPABILITIES,
    ROLE_INDIVIDUAL_CREATOR,
    ROLE_PLATFORM_SUPER_ADMIN,
    SYSTEM_ROLES,
)
from ...common.log import get_logger
from ...db.session import session_scope
from ...repository import (
    InvitationRepository,
    MembershipRepository,
    OrganizationRepository,
    RoleRepository,
    UserRepository,
    UserSessionRepository,
    VerificationCodeRepository,
    WorkspaceRepository,
)
from ...schemas.models import (
    AuthMeResponse,
    AuthSessionPayload,
    Invitation,
    Membership,
    MembershipWithRole,
    Organization,
    Role,
    User,
    UserSession,
    VerificationCode,
    Workspace,
    WorkspaceOption,
)
from ...settings.env_settings import get_env, get_env_bool
from ...utils.datetime import utc_now


logger = get_logger(__name__)
SUPPORTED_AUTH_PURPOSES = {"signin", "signup"}


@dataclass
class AccessTokenClaims:
    user_id: str
    session_id: str
    workspace_id: str | None


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _b64url_encode(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return urlsafe_b64decode(data + padding)


def _coerce_utc(value):
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _slugify(value: str) -> str:
    raw = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    compact = "-".join(part for part in raw.split("-") if part)
    return compact[:48] or f"space-{uuid.uuid4().hex[:8]}"


def _minutes_from_env(key: str, default: int) -> int:
    value = get_env(key)
    if value is None:
        return default
    try:
        return max(1, int(value))
    except ValueError:
        return default


def _days_from_env(key: str, default: int) -> int:
    value = get_env(key)
    if value is None:
        return default
    try:
        return max(1, int(value))
    except ValueError:
        return default


class AuthService:
    """统一管理邮箱验证码登录、会话和工作区权限上下文。"""

    def __init__(self):
        self.user_repository = UserRepository()
        self.role_repository = RoleRepository()
        self.membership_repository = MembershipRepository()
        self.organization_repository = OrganizationRepository()
        self.workspace_repository = WorkspaceRepository()
        self.verification_code_repository = VerificationCodeRepository()
        self.user_session_repository = UserSessionRepository()
        self.invitation_repository = InvitationRepository()

    def ensure_default_roles(self) -> None:
        for code, name, description in SYSTEM_ROLES:
            if self.role_repository.get_by_code(code):
                continue
            now = utc_now()
            self.role_repository.create(
                Role(
                    id=str(uuid.uuid4()),
                    code=code,
                    name=name,
                    description=description,
                    is_system=True,
                    created_at=now,
                    updated_at=now,
                )
            )

    def send_email_code(self, email: str, purpose: str) -> dict:
        normalized_email = _normalize_email(email)
        # 中文注释：登录/注册入口已经拆分，只允许显式支持的认证用途继续向下执行。
        if purpose not in SUPPORTED_AUTH_PURPOSES:
            raise ValueError("Unsupported auth purpose")
        code = f"{secrets.randbelow(1_000_000):06d}"
        now = utc_now()
        verification = VerificationCode(
            id=str(uuid.uuid4()),
            target_type="email",
            target_value=normalized_email,
            purpose=purpose,
            code_hash=_hash_text(code),
            expires_at=now + timedelta(minutes=_minutes_from_env("AUTH_EMAIL_CODE_TTL_MINUTES", 10)),
            attempt_count=0,
            max_attempts=5,
            created_at=now,
            updated_at=now,
        )
        self.verification_code_repository.create(verification)
        logger.info("AUTH_SERVICE: email code generated email=%s purpose=%s code=%s", normalized_email, purpose, code)
        payload = {"status": "sent", "email": normalized_email, "purpose": purpose}
        if self._email_delivery_is_configured():
            self._send_email_code_via_smtp(normalized_email, code, purpose)
        elif get_env_bool("AUTH_EXPOSE_TEST_CODE", False):
            payload["debug_code"] = code
        else:
            raise ValueError("Email delivery is not configured. Set SMTP config or enable AUTH_EXPOSE_TEST_CODE for testing.")
        return payload

    def verify_email_code(
        self,
        email: str,
        code: str,
        purpose: str,
        display_name: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[AuthSessionPayload, AuthMeResponse, str]:
        normalized_email = _normalize_email(email)
        # 中文注释：登录和注册现在是两条明确路径，避免老用户误走注册或新用户误走登录。
        if purpose not in SUPPORTED_AUTH_PURPOSES:
            raise ValueError("Unsupported auth purpose")
        latest = self.verification_code_repository.get_latest_active("email", normalized_email, purpose)
        if latest is None:
            raise ValueError("Verification code not found")
        if latest.consumed_at is not None:
            raise ValueError("Verification code already used")
        if _coerce_utc(latest.expires_at) < utc_now():
            raise ValueError("Verification code expired")
        if latest.attempt_count >= latest.max_attempts:
            raise ValueError("Verification code exceeded max attempts")
        if not hmac.compare_digest(latest.code_hash, _hash_text(code.strip())):
            self.verification_code_repository.mark_attempt(latest.id)
            raise ValueError("Verification code is invalid")
        self.verification_code_repository.consume(latest.id)

        user = self.user_repository.get_by_email(normalized_email)
        if purpose == "signin" and user is None:
            raise ValueError("Account not found, please sign up first")
        if purpose == "signup" and user is not None:
            raise ValueError("Account already exists, please sign in")

        if user is None:
            user = self._create_user_with_personal_workspace(normalized_email, display_name)
        else:
            patch = {
                "last_login_at": utc_now(),
                "display_name": display_name or user.display_name,
            }
            user = self.user_repository.update(user.id, patch)

        self._accept_pending_invitations(user)
        current_workspace = self._pick_default_workspace(user)
        auth_payload, refresh_token = self.issue_session(
            user=user,
            current_workspace_id=current_workspace.workspace_id if current_workspace else None,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        me = self.build_auth_me(user, current_workspace.workspace_id if current_workspace else None)
        return auth_payload, me, refresh_token

    def issue_session(
        self,
        user: User,
        current_workspace_id: str | None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[AuthSessionPayload, str]:
        refresh_token = secrets.token_urlsafe(48)
        now = utc_now()
        refresh_ttl_days = _days_from_env("AUTH_REFRESH_TOKEN_TTL_DAYS", 30)
        session_model = UserSession(
            id=str(uuid.uuid4()),
            user_id=user.id,
            current_workspace_id=current_workspace_id,
            session_token_hash=_hash_text(refresh_token),
            expires_at=now + timedelta(days=refresh_ttl_days),
            revoked_at=None,
            ip_address=ip_address,
            user_agent=user_agent,
            created_at=now,
            updated_at=now,
        )
        self.user_session_repository.create(session_model)
        return self._build_access_payload(user.id, session_model.id, current_workspace_id), refresh_token

    def refresh_session(self, refresh_token: str) -> tuple[AuthSessionPayload, AuthMeResponse]:
        token_hash = _hash_text(refresh_token)
        session_model = self.user_session_repository.get_by_token_hash(token_hash)
        if session_model is None or session_model.revoked_at is not None or _coerce_utc(session_model.expires_at) < utc_now():
            raise ValueError("Session is invalid or expired")
        user = self.user_repository.get(session_model.user_id)
        if user is None or user.status != "active":
            raise ValueError("User is unavailable")
        payload = self._build_access_payload(user.id, session_model.id, session_model.current_workspace_id)
        return payload, self.build_auth_me(user, session_model.current_workspace_id)

    def logout(self, refresh_token: str) -> None:
        if not refresh_token:
            return
        self.user_session_repository.revoke_by_token_hash(_hash_text(refresh_token))

    def switch_workspace(self, user: User, refresh_token: str, workspace_id: str) -> tuple[AuthSessionPayload, AuthMeResponse]:
        workspace_options = {item.workspace_id: item for item in self._list_workspace_options(user)}
        if workspace_id not in workspace_options:
            raise ValueError("Workspace not found or not accessible")
        session_model = self.user_session_repository.get_by_token_hash(_hash_text(refresh_token))
        if session_model is None or session_model.revoked_at is not None:
            raise ValueError("Session not found")
        self.user_session_repository.update(session_model.id, {"current_workspace_id": workspace_id})
        payload = self._build_access_payload(user.id, session_model.id, workspace_id)
        return payload, self.build_auth_me(user, workspace_id)

    def decode_access_token(self, access_token: str) -> AccessTokenClaims:
        try:
            payload = self._decode_jwt(access_token)
        except ValueError as exc:
            raise ValueError("Access token is invalid") from exc
        return AccessTokenClaims(
            user_id=str(payload["sub"]),
            session_id=str(payload["sid"]),
            workspace_id=payload.get("wid"),
        )

    def build_auth_me(self, user: User, current_workspace_id: str | None = None) -> AuthMeResponse:
        memberships = self._list_memberships_with_role(user.id)
        workspace_options = self._list_workspace_options(user, memberships)
        if current_workspace_id is None and workspace_options:
            current_workspace_id = workspace_options[0].workspace_id
        current_workspace = next((item for item in workspace_options if item.workspace_id == current_workspace_id), None)
        current_role_code = current_workspace.role_code if current_workspace else None
        current_role_name = current_workspace.role_name if current_workspace else None
        capabilities = sorted(self._get_capabilities(user.platform_role, current_role_code))
        return AuthMeResponse(
            user=user,
            current_workspace_id=current_workspace_id,
            current_organization_id=current_workspace.organization_id if current_workspace else None,
            current_role_code=current_role_code,
            current_role_name=current_role_name,
            is_platform_super_admin=user.platform_role == ROLE_PLATFORM_SUPER_ADMIN,
            capabilities=capabilities,
            workspaces=workspace_options,
            memberships=memberships,
        )

    def list_workspace_members(self, workspace_id: str) -> list[MembershipWithRole]:
        with session_scope() as session:
            from ...db.models import MembershipRecord, OrganizationRecord, RoleRecord, UserRecord, WorkspaceRecord

            rows = (
                session.query(MembershipRecord, UserRecord, RoleRecord, WorkspaceRecord, OrganizationRecord)
                .join(UserRecord, UserRecord.id == MembershipRecord.user_id)
                .outerjoin(RoleRecord, RoleRecord.id == MembershipRecord.role_id)
                .outerjoin(WorkspaceRecord, WorkspaceRecord.id == MembershipRecord.workspace_id)
                .outerjoin(OrganizationRecord, OrganizationRecord.id == MembershipRecord.organization_id)
                .filter(MembershipRecord.workspace_id == workspace_id)
                .order_by(MembershipRecord.created_at.asc())
                .all()
            )
            return [
                MembershipWithRole(
                    membership_id=membership.id,
                    organization_id=membership.organization_id,
                    organization_name=organization.name if organization else None,
                    workspace_id=membership.workspace_id,
                    workspace_name=workspace.name if workspace else None,
                    user_id=user.id,
                    email=user.email,
                    display_name=user.display_name,
                    role_id=role.id if role else None,
                    role_code=role.code if role else None,
                    role_name=role.name if role else None,
                    status=membership.status,
                    created_at=membership.created_at,
                    updated_at=membership.updated_at,
                )
                for membership, user, role, workspace, organization in rows
            ]

    def invite_workspace_member(self, organization_id: str, workspace_id: str, email: str, role_code: str, invited_by: str | None) -> Invitation:
        normalized_email = _normalize_email(email)
        role = self.role_repository.get_by_code(role_code)
        if role is None:
            raise ValueError("Role not found")
        now = utc_now()
        invitation = Invitation(
            id=str(uuid.uuid4()),
            organization_id=organization_id,
            workspace_id=workspace_id,
            email=normalized_email,
            role_code=role_code,
            invited_by=invited_by,
            expires_at=now + timedelta(days=_days_from_env("AUTH_INVITATION_TTL_DAYS", 7)),
            accepted_at=None,
            created_at=now,
            updated_at=now,
        )
        self.invitation_repository.create(invitation)
        self.send_email_code(normalized_email, "invite_accept")
        return invitation

    def update_workspace_member_role(self, membership_id: str, role_code: str) -> Membership:
        membership = self.membership_repository.get(membership_id)
        if membership is None:
            raise ValueError("Membership not found")
        role = self.role_repository.get_by_code(role_code)
        if role is None:
            raise ValueError("Role not found")
        return self.membership_repository.update(membership_id, {"role_id": role.id})

    def remove_workspace_member(self, membership_id: str) -> None:
        self.membership_repository.delete(membership_id)

    def _create_user_with_personal_workspace(self, email: str, display_name: str | None) -> User:
        now = utc_now()
        effective_name = (display_name or email.split("@")[0]).strip() or "创作者"
        platform_role = ROLE_PLATFORM_SUPER_ADMIN if email in self._platform_super_admin_emails() else None
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            display_name=effective_name,
            auth_provider="email_otp",
            platform_role=platform_role,
            status="active",
            last_login_at=now,
            created_at=now,
            updated_at=now,
        )
        self.user_repository.create(user)

        organization = Organization(
            id=str(uuid.uuid4()),
            name=f"个人空间 - {effective_name}",
            slug=_slugify(f"personal-{effective_name}-{uuid.uuid4().hex[:4]}"),
            status="active",
            created_at=now,
            updated_at=now,
        )
        self.organization_repository.create(organization)

        workspace = Workspace(
            id=str(uuid.uuid4()),
            organization_id=organization.id,
            name="默认工作区",
            slug="default-workspace",
            status="active",
            created_at=now,
            updated_at=now,
        )
        self.workspace_repository.create(workspace)

        personal_role = self.role_repository.get_by_code(ROLE_INDIVIDUAL_CREATOR)
        if personal_role is None:
            raise ValueError("Default individual creator role is missing")
        self.membership_repository.create(
            Membership(
                id=str(uuid.uuid4()),
                organization_id=organization.id,
                workspace_id=workspace.id,
                user_id=user.id,
                role_id=personal_role.id,
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
        return self.user_repository.get(user.id) or user

    def _accept_pending_invitations(self, user: User) -> None:
        invitations = self.invitation_repository.list_pending_by_email(user.email or "")
        for invitation in invitations:
            if _coerce_utc(invitation.expires_at) < utc_now():
                continue
            role = self.role_repository.get_by_code(invitation.role_code)
            if role is None:
                continue
            if not self.membership_repository.exists_conflict(None, invitation.organization_id, invitation.workspace_id, user.id, role.id):
                now = utc_now()
                self.membership_repository.create(
                    Membership(
                        id=str(uuid.uuid4()),
                        organization_id=invitation.organization_id,
                        workspace_id=invitation.workspace_id,
                        user_id=user.id,
                        role_id=role.id,
                        status="active",
                        created_at=now,
                        updated_at=now,
                    )
                )
            self.invitation_repository.mark_accepted(invitation.id)

    def _pick_default_workspace(self, user: User) -> WorkspaceOption | None:
        workspaces = self._list_workspace_options(user)
        return workspaces[0] if workspaces else None

    def _list_memberships_with_role(self, user_id: str) -> list[MembershipWithRole]:
        with session_scope() as session:
            from ...db.models import MembershipRecord, OrganizationRecord, RoleRecord, UserRecord, WorkspaceRecord

            rows = (
                session.query(MembershipRecord, UserRecord, RoleRecord, WorkspaceRecord, OrganizationRecord)
                .join(UserRecord, UserRecord.id == MembershipRecord.user_id)
                .outerjoin(RoleRecord, RoleRecord.id == MembershipRecord.role_id)
                .outerjoin(WorkspaceRecord, WorkspaceRecord.id == MembershipRecord.workspace_id)
                .outerjoin(OrganizationRecord, OrganizationRecord.id == MembershipRecord.organization_id)
                .filter(MembershipRecord.user_id == user_id, MembershipRecord.status == "active")
                .order_by(MembershipRecord.created_at.asc())
                .all()
            )
            return [
                MembershipWithRole(
                    membership_id=membership.id,
                    organization_id=membership.organization_id,
                    organization_name=organization.name if organization else None,
                    workspace_id=membership.workspace_id,
                    workspace_name=workspace.name if workspace else None,
                    user_id=user.id,
                    email=user.email,
                    display_name=user.display_name,
                    role_id=role.id if role else None,
                    role_code=role.code if role else None,
                    role_name=role.name if role else None,
                    status=membership.status,
                    created_at=membership.created_at,
                    updated_at=membership.updated_at,
                )
                for membership, user, role, workspace, organization in rows
            ]

    def _list_workspace_options(self, user: User, memberships: list[MembershipWithRole] | None = None) -> list[WorkspaceOption]:
        memberships = memberships if memberships is not None else self._list_memberships_with_role(user.id)
        return [
            WorkspaceOption(
                organization_id=item.organization_id,
                organization_name=item.organization_name,
                workspace_id=item.workspace_id or "",
                workspace_name=item.workspace_name,
                role_code=item.role_code,
                role_name=item.role_name,
            )
            for item in memberships
            if item.workspace_id
        ]

    def _get_capabilities(self, platform_role: str | None, workspace_role: str | None) -> set[str]:
        capabilities = set()
        if platform_role:
            capabilities.update(ROLE_CAPABILITIES.get(platform_role, set()))
        if workspace_role:
            capabilities.update(ROLE_CAPABILITIES.get(workspace_role, set()))
        return capabilities

    def _build_access_payload(self, user_id: str, session_id: str, workspace_id: str | None) -> AuthSessionPayload:
        expires_in_minutes = _minutes_from_env("AUTH_ACCESS_TOKEN_TTL_MINUTES", 30)
        now = utc_now()
        token = self._encode_jwt(
            {
                "sub": user_id,
                "sid": session_id,
                "wid": workspace_id,
                "iat": int(now.timestamp()),
                "exp": int((now + timedelta(minutes=expires_in_minutes)).timestamp()),
            }
        )
        return AuthSessionPayload(
            access_token=token,
            token_type="bearer",
            expires_in=expires_in_minutes * 60,
        )

    def _platform_super_admin_emails(self) -> set[str]:
        raw = get_env("AUTH_PLATFORM_SUPER_ADMIN_EMAILS", "") or ""
        return {_normalize_email(item) for item in raw.split(",") if item.strip()}

    def _email_delivery_is_configured(self) -> bool:
        required = [
            "AUTH_EMAIL_SMTP_HOST",
            "AUTH_EMAIL_SMTP_USER",
            "AUTH_EMAIL_SMTP_PASSWORD",
            "AUTH_EMAIL_FROM",
        ]
        return all((get_env(item) or "").strip() for item in required)

    def _send_email_code_via_smtp(self, email: str, code: str, purpose: str) -> None:
        smtp_host = get_env("AUTH_EMAIL_SMTP_HOST")
        smtp_port = int(get_env("AUTH_EMAIL_SMTP_PORT", "587") or "587")
        smtp_user = get_env("AUTH_EMAIL_SMTP_USER")
        smtp_password = get_env("AUTH_EMAIL_SMTP_PASSWORD")
        smtp_from = get_env("AUTH_EMAIL_FROM")
        use_ssl = get_env_bool("AUTH_EMAIL_SMTP_SSL", False)
        use_tls = get_env_bool("AUTH_EMAIL_SMTP_TLS", True)

        message = EmailMessage()
        message["From"] = smtp_from
        message["To"] = email
        message["Subject"] = "DramaLab 登录验证码"
        message.set_content(
            f"你的 DramaLab 验证码是：{code}\n\n"
            f"用途：{purpose}\n"
            "验证码 10 分钟内有效，请勿泄露给他人。"
        )

        smtp_cls = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
        with smtp_cls(smtp_host, smtp_port, timeout=20) as server:
            if not use_ssl and use_tls:
                server.starttls()
            if smtp_user and smtp_password:
                server.login(smtp_user, smtp_password)
            server.send_message(message)

    def _encode_jwt(self, payload: dict) -> str:
        header = {"alg": "HS256", "typ": "JWT"}
        header_segment = _b64url_encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        payload_segment = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        signing_input = f"{header_segment}.{payload_segment}"
        secret = (get_env("AUTH_JWT_SECRET", "lumenx-dev-secret") or "lumenx-dev-secret").encode("utf-8")
        signature = hmac.new(secret, signing_input.encode("utf-8"), hashlib.sha256).digest()
        return f"{signing_input}.{_b64url_encode(signature)}"

    def _decode_jwt(self, token: str) -> dict:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Invalid token format")
        header_segment, payload_segment, signature_segment = parts
        signing_input = f"{header_segment}.{payload_segment}"
        secret = (get_env("AUTH_JWT_SECRET", "lumenx-dev-secret") or "lumenx-dev-secret").encode("utf-8")
        expected_signature = _b64url_encode(hmac.new(secret, signing_input.encode("utf-8"), hashlib.sha256).digest())
        if not hmac.compare_digest(expected_signature, signature_segment):
            raise ValueError("Invalid token signature")
        payload = json.loads(_b64url_decode(payload_segment).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(utc_now().timestamp()):
            raise ValueError("Token expired")
        return payload
