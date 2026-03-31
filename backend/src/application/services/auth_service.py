"""认证、会话与工作区权限服务。"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import secrets
import smtplib
import time
import uuid
from base64 import urlsafe_b64decode, urlsafe_b64encode
from dataclasses import dataclass
from datetime import timedelta, timezone
from email.message import EmailMessage

from ...auth.constants import (
    ROLE_ORG_ADMIN,
    ROLE_CAPABILITIES,
    ROLE_INDIVIDUAL_CREATOR,
    ROLE_PLATFORM_SUPER_ADMIN,
    SYSTEM_ROLES,
)
from ...common.log import get_logger
from ...db.session import session_scope
from ...repository import (
    AuthRateLimitRepository,
    CaptchaChallengeRepository,
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
    AuthRateLimitEntry,
    CaptchaChallenge,
    CaptchaChallengePayload,
    Invitation,
    InvitationPreview,
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
SUPPORTED_AUTH_PURPOSES = {"signin", "signup", "invite_accept", "reset_password"}
SUPPORTED_SIGNUP_KINDS = {ROLE_INDIVIDUAL_CREATOR, ROLE_ORG_ADMIN}
PASSWORD_HASH_ITERATIONS = 120_000
DEFAULT_EXISTING_USER_PASSWORD = "123456"
SUPPORTED_AUTH_CHANNELS = {"email", "phone"}
CAPTCHA_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
CAPTCHA_LENGTH = 5
CAPTCHA_TTL_SECONDS = 300
AUTH_SEND_CODE_ACTION = "verification_code_send"
AUTH_SEND_COOLDOWN_SECONDS = 60
AUTH_SEND_LIMIT_PER_IDENTIFIER_PER_HOUR = 5
AUTH_SEND_LIMIT_PER_IP_PER_HOUR = 20


class AuthRateLimitError(ValueError):
    """认证限流错误。"""

    def __init__(self, message: str, retry_after_seconds: int | None = None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


@dataclass
class AccessTokenClaims:
    user_id: str
    session_id: str
    workspace_id: str | None


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_phone(phone: str) -> str:
    raw = phone.strip()
    if raw.startswith("+"):
        digits = "".join(ch for ch in raw if ch.isdigit())
        return f"+{digits}" if digits else ""
    return "".join(ch for ch in raw if ch.isdigit())


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _hash_password(password: str, salt: str | None = None) -> str:
    resolved_salt = salt or secrets.token_hex(16)
    derived_key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        resolved_salt.encode("utf-8"),
        PASSWORD_HASH_ITERATIONS,
    )
    return f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}${resolved_salt}${derived_key.hex()}"


def _verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        algorithm, iteration_value, salt, expected_hash = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        derived_key = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            int(iteration_value),
        ).hex()
        return hmac.compare_digest(derived_key, expected_hash)
    except (TypeError, ValueError):
        return False


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


def _seconds_from_env(key: str, default: int) -> int:
    value = get_env(key)
    if value is None:
        return default
    try:
        return max(1, int(value))
    except ValueError:
        return default


def _count_from_env(key: str, default: int) -> int:
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
        self.captcha_challenge_repository = CaptchaChallengeRepository()
        self.auth_rate_limit_repository = AuthRateLimitRepository()
        self.user_session_repository = UserSessionRepository()
        self.invitation_repository = InvitationRepository()

    def create_captcha_challenge(self) -> CaptchaChallengePayload:
        # 中文注释：图形验证码挑战落库后即可跨进程校验，避免把一次性校验状态绑死在单机内存里。
        code = "".join(secrets.choice(CAPTCHA_ALPHABET) for _ in range(CAPTCHA_LENGTH))
        now = utc_now()
        challenge = CaptchaChallenge(
            id=str(uuid.uuid4()),
            code_hash=_hash_text(code),
            expires_at=now + timedelta(seconds=self._captcha_ttl_seconds()),
            consumed_at=None,
            created_at=now,
            updated_at=now,
        )
        self.captcha_challenge_repository.create(challenge)
        return CaptchaChallengePayload(
            captcha_id=challenge.id,
            image_svg=self._build_captcha_svg(code),
            expires_in_seconds=self._captcha_ttl_seconds(),
            debug_code=code if get_env_bool("AUTH_EXPOSE_TEST_CODE", False) else None,
        )

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

    def send_email_code(self, email: str, purpose: str, ip_address: str | None = None) -> dict:
        return self.send_verification_code("email", email, purpose, ip_address)

    def send_verification_code(self, target_type: str, identifier: str, purpose: str, ip_address: str | None = None) -> dict:
        normalized_identifier = self._normalize_identifier(target_type, identifier)
        # 中文注释：登录/注册入口已经拆分，只允许显式支持的认证用途继续向下执行。
        if purpose not in SUPPORTED_AUTH_PURPOSES:
            raise ValueError("Unsupported auth purpose")
        if purpose == "signup":
            # 中文注释：公开注册在发码前就拦截已有账号和保留的系统邮箱，避免前端误以为这些身份仍可注册。
            if self._get_user_by_identifier(target_type, normalized_identifier) is not None:
                raise ValueError("Account already exists, please sign in")
        if target_type == "email" and normalized_identifier in self._platform_super_admin_emails():
            raise ValueError("This email is reserved for platform administration and cannot use public sign up")
        if purpose == "reset_password" and self._get_user_by_identifier(target_type, normalized_identifier) is None:
            raise ValueError("Account not found, please sign up first")
        self._ensure_send_code_not_rate_limited(normalized_identifier, ip_address)
        code = f"{secrets.randbelow(1_000_000):06d}"
        now = utc_now()
        verification = VerificationCode(
            id=str(uuid.uuid4()),
            target_type=target_type,
            target_value=normalized_identifier,
            purpose=purpose,
            code_hash=_hash_text(code),
            expires_at=now + timedelta(minutes=_minutes_from_env("AUTH_EMAIL_CODE_TTL_MINUTES", 10)),
            attempt_count=0,
            max_attempts=5,
            created_at=now,
            updated_at=now,
        )
        self.verification_code_repository.create(verification)
        self._record_send_code_rate_limit(normalized_identifier, ip_address)
        logger.info("AUTH_SERVICE: verification code generated target_type=%s target=%s purpose=%s code=%s", target_type, normalized_identifier, purpose, code)
        payload = {"status": "sent", "target": normalized_identifier, "channel": target_type, "purpose": purpose}
        if target_type == "email" and self._email_delivery_is_configured():
            self._send_email_code_via_smtp(normalized_identifier, code, purpose)
        elif get_env_bool("AUTH_EXPOSE_TEST_CODE", False):
            payload["debug_code"] = code
        else:
            if target_type == "phone":
                raise ValueError("SMS delivery is not configured. Enable AUTH_EXPOSE_TEST_CODE for testing.")
            raise ValueError("Email delivery is not configured. Set SMTP config or enable AUTH_EXPOSE_TEST_CODE for testing.")
        return payload

    def verify_captcha(self, captcha_id: str, captcha_code: str) -> None:
        # 中文注释：验证码校验统一在 service 层处理，保证所有认证入口复用同一套过期/一次性规则。
        normalized_code = "".join(ch for ch in (captcha_code or "").strip().upper() if ch.isalnum())
        if not captcha_id or not normalized_code:
            raise ValueError("Captcha is required")
        challenge = self.captcha_challenge_repository.get(captcha_id)
        if challenge is None or challenge.consumed_at is not None or _coerce_utc(challenge.expires_at) < utc_now():
            raise ValueError("Captcha is invalid or expired")
        if not hmac.compare_digest(challenge.code_hash, _hash_text(normalized_code)):
            raise ValueError("Captcha is incorrect")
        self.captcha_challenge_repository.consume(challenge.id)

    def sign_in_with_password(
        self,
        identifier: str,
        target_type: str,
        password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[AuthSessionPayload, AuthMeResponse, str]:
        normalized_identifier = self._normalize_identifier(target_type, identifier)
        user = self._get_user_by_identifier(target_type, normalized_identifier)
        if user is None:
            raise ValueError("Account not found, please sign up first")
        if not _verify_password(password, user.password_hash):
            raise ValueError("Email or password is incorrect")
        user = self.user_repository.update(
            user.id,
            {
                "last_login_at": utc_now(),
                "auth_provider": "email_password",
            },
        )
        current_workspace = self._pick_default_workspace(user)
        auth_payload, refresh_token = self.issue_session(
            user=user,
            current_workspace_id=current_workspace.workspace_id if current_workspace else None,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        me = self.build_auth_me(user, current_workspace.workspace_id if current_workspace else None)
        return auth_payload, me, refresh_token

    def sign_up_with_password(
        self,
        identifier: str,
        target_type: str,
        password: str,
        display_name: str | None = None,
        signup_kind: str | None = None,
        organization_name: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[AuthSessionPayload, AuthMeResponse, str]:
        normalized_identifier = self._normalize_identifier(target_type, identifier)
        if self._get_user_by_identifier(target_type, normalized_identifier) is not None:
            raise ValueError("Account already exists, please sign in")
        if target_type == "email" and normalized_identifier in self._platform_super_admin_emails():
            raise ValueError("This email is reserved for platform administration and cannot use public sign up")
        self._validate_password(password)

        resolved_signup_kind = signup_kind or ROLE_INDIVIDUAL_CREATOR
        if resolved_signup_kind not in SUPPORTED_SIGNUP_KINDS:
            raise ValueError("Unsupported signup kind")

        if resolved_signup_kind == ROLE_ORG_ADMIN:
            user = self._create_user_with_org_workspace(
                normalized_identifier,
                target_type,
                display_name,
                organization_name,
                password=password,
                auth_provider="email_password",
            )
        else:
            user = self._create_user_with_personal_workspace(
                normalized_identifier,
                target_type,
                display_name,
                password=password,
                auth_provider="email_password",
            )

        current_workspace = self._pick_default_workspace(user)
        auth_payload, refresh_token = self.issue_session(
            user=user,
            current_workspace_id=current_workspace.workspace_id if current_workspace else None,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        me = self.build_auth_me(user, current_workspace.workspace_id if current_workspace else None)
        return auth_payload, me, refresh_token

    def reset_password_with_code(
        self,
        identifier: str,
        target_type: str,
        code: str,
        new_password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[AuthSessionPayload, AuthMeResponse, str]:
        normalized_identifier = self._normalize_identifier(target_type, identifier)
        self._validate_password(new_password)
        self._consume_verification_code(target_type, normalized_identifier, code, "reset_password")
        user = self._get_user_by_identifier(target_type, normalized_identifier)
        if user is None:
            raise ValueError("Account not found, please sign up first")
        user = self.user_repository.update(
            user.id,
            {
                "password_hash": _hash_password(new_password),
                "auth_provider": "email_password",
                "last_login_at": utc_now(),
            },
        )
        self.user_session_repository.revoke_all_for_user(user.id)
        current_workspace = self._pick_default_workspace(user)
        auth_payload, refresh_token = self.issue_session(
            user=user,
            current_workspace_id=current_workspace.workspace_id if current_workspace else None,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        me = self.build_auth_me(user, current_workspace.workspace_id if current_workspace else None)
        return auth_payload, me, refresh_token

    def change_password(
        self,
        user: User,
        current_password: str,
        new_password: str,
        current_session_refresh_token: str | None = None,
    ) -> User:
        if not _verify_password(current_password, user.password_hash):
            raise ValueError("Current password is incorrect")
        self._validate_password(new_password)
        updated_user = self.user_repository.update(
            user.id,
            {
                "password_hash": _hash_password(new_password),
                "auth_provider": "email_password",
                "last_login_at": utc_now(),
            },
        )
        current_session = None
        if current_session_refresh_token:
            current_session = self.user_session_repository.get_by_token_hash(_hash_text(current_session_refresh_token))
        self.user_session_repository.revoke_all_for_user(updated_user.id, except_session_id=current_session.id if current_session else None)
        return updated_user

    def verify_email_code(
        self,
        email: str,
        code: str,
        purpose: str,
        display_name: str | None = None,
        signup_kind: str | None = None,
        organization_name: str | None = None,
        invitation_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[AuthSessionPayload, AuthMeResponse, str]:
        normalized_email = self._normalize_identifier("email", email)
        return self.verify_identifier_code(
            identifier=normalized_email,
            target_type="email",
            code=code,
            purpose=purpose,
            display_name=display_name,
            signup_kind=signup_kind,
            organization_name=organization_name,
            invitation_id=invitation_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )

    def verify_identifier_code(
        self,
        identifier: str,
        target_type: str,
        code: str,
        purpose: str,
        display_name: str | None = None,
        signup_kind: str | None = None,
        organization_name: str | None = None,
        invitation_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[AuthSessionPayload, AuthMeResponse, str]:
        normalized_identifier = self._normalize_identifier(target_type, identifier)
        # 中文注释：登录和注册现在是两条明确路径，避免老用户误走注册或新用户误走登录。
        if purpose not in SUPPORTED_AUTH_PURPOSES:
            raise ValueError("Unsupported auth purpose")
        if purpose == "reset_password":
            raise ValueError("Use password reset endpoint")
        self._consume_verification_code(target_type, normalized_identifier, code, purpose)

        user = self._get_user_by_identifier(target_type, normalized_identifier)
        if purpose == "signin" and user is None:
            raise ValueError("Account not found, please sign up first")
        if purpose == "signup" and user is not None:
            raise ValueError("Account already exists, please sign in")
        if purpose == "invite_accept":
            normalized_email = normalized_identifier
            invitation = self._resolve_pending_invitation(normalized_email, invitation_id)
            if invitation is None:
                raise ValueError("Invitation not found or already accepted")

        if user is None:
            if purpose == "signup":
                resolved_signup_kind = signup_kind or ROLE_INDIVIDUAL_CREATOR
                if resolved_signup_kind not in SUPPORTED_SIGNUP_KINDS:
                    raise ValueError("Unsupported signup kind")
                if resolved_signup_kind == ROLE_ORG_ADMIN:
                    user = self._create_user_with_org_workspace(normalized_identifier, target_type, display_name, organization_name)
                else:
                    user = self._create_user_with_personal_workspace(normalized_identifier, target_type, display_name)
            elif purpose == "invite_accept":
                user = self._create_invited_user(normalized_identifier, display_name)
            else:
                raise ValueError("Account not found, please sign up first")
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

    def ensure_existing_users_have_initial_password(self) -> int:
        updated_count = 0
        for user in self.user_repository.list():
            if (not user.email and not user.phone) or user.password_hash:
                continue
            self.user_repository.update(
                user.id,
                {
                    "password_hash": _hash_password(DEFAULT_EXISTING_USER_PASSWORD),
                },
            )
            updated_count += 1
        if updated_count:
            logger.info("AUTH_SERVICE: backfilled initial password for existing users count=%s", updated_count)
        return updated_count

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
        started_at = time.perf_counter()
        memberships_started_at = time.perf_counter()
        memberships = self._list_memberships_with_role(user.id)
        memberships_duration_ms = (time.perf_counter() - memberships_started_at) * 1000
        workspace_started_at = time.perf_counter()
        workspace_options = self._list_workspace_options(user, memberships)
        workspace_duration_ms = (time.perf_counter() - workspace_started_at) * 1000
        if current_workspace_id is None and workspace_options:
            current_workspace_id = workspace_options[0].workspace_id
        current_workspace = next((item for item in workspace_options if item.workspace_id == current_workspace_id), None)
        current_role_code = current_workspace.role_code if current_workspace else None
        current_role_name = current_workspace.role_name if current_workspace else None
        capabilities = sorted(self._get_capabilities(user.platform_role, current_role_code))
        response = AuthMeResponse(
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
        logger.info(
            "AUTH_SERVICE: build_auth_me user_id=%s workspace_id=%s memberships=%s workspaces=%s membership_query_ms=%.2f workspace_build_ms=%.2f total_ms=%.2f",
            user.id,
            current_workspace_id,
            len(memberships),
            len(workspace_options),
            memberships_duration_ms,
            workspace_duration_ms,
            (time.perf_counter() - started_at) * 1000,
        )
        return response

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

    def list_workspace_invitations(self, workspace_id: str) -> list[Invitation]:
        """获取工作区下所有待处理的邀请。"""
        return self.invitation_repository.list_pending_by_workspace(workspace_id)

    def remove_workspace_invitation(self, invitation_id: str) -> None:
        """撤销一个尚未接受的邀请。"""
        self.invitation_repository.delete(invitation_id)

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
        self._send_invitation_email(invitation)
        return invitation

    def get_invitation_preview(self, invitation_id: str) -> InvitationPreview:
        invitation = self.invitation_repository.get(invitation_id)
        if invitation is None:
            raise ValueError("Invitation not found")
        organization = self.organization_repository.get(invitation.organization_id)
        workspace = self.workspace_repository.get(invitation.workspace_id)
        role = self.role_repository.get_by_code(invitation.role_code)
        return InvitationPreview(
            id=invitation.id,
            email=invitation.email,
            role_code=invitation.role_code,
            role_name=role.name if role else None,
            organization_id=invitation.organization_id,
            organization_name=organization.name if organization else None,
            workspace_id=invitation.workspace_id,
            workspace_name=workspace.name if workspace else None,
            expires_at=invitation.expires_at,
            accepted_at=invitation.accepted_at,
            is_expired=_coerce_utc(invitation.expires_at) < utc_now(),
        )

    def build_invitation_url_for_client(self, invitation_id: str) -> str:
        return self._build_invitation_url(invitation_id)

    def update_current_organization(self, organization_id: str, name: str) -> Organization:
        # 中文注释：当前组织设置只允许更新展示名称，避免公开设置页误改更敏感的租户字段。
        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("Organization name is required")
        return self.organization_repository.update(organization_id, {"name": normalized_name})

    def update_current_workspace(self, workspace_id: str, name: str) -> Workspace:
        # 中文注释：工作区设置与组织设置分开落库，减少误把两者混成一个实体。
        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("Workspace name is required")
        return self.workspace_repository.update(workspace_id, {"name": normalized_name})

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

    def _create_user_with_personal_workspace(
        self,
        identifier: str,
        target_type: str,
        display_name: str | None,
        password: str | None = None,
        auth_provider: str = "email_otp",
    ) -> User:
        # 中文注释：个人注册会自动创建个人组织与默认工作区，并授予个人创作者角色。
        return self._create_user_with_workspace(
            identifier=identifier,
            target_type=target_type,
            display_name=display_name,
            role_code=ROLE_INDIVIDUAL_CREATOR,
            organization_name=None,
            workspace_name="默认工作区",
            use_personal_prefix=True,
            password=password,
            auth_provider=auth_provider,
        )

    def _create_user_with_org_workspace(
        self,
        identifier: str,
        target_type: str,
        display_name: str | None,
        organization_name: str | None,
        password: str | None = None,
        auth_provider: str = "email_otp",
    ) -> User:
        # 中文注释：企业管理员注册会直接创建团队组织与默认工作区，并授予组织管理员角色。
        return self._create_user_with_workspace(
            identifier=identifier,
            target_type=target_type,
            display_name=display_name,
            role_code=ROLE_ORG_ADMIN,
            organization_name=organization_name,
            workspace_name="默认工作区",
            use_personal_prefix=False,
            password=password,
            auth_provider=auth_provider,
        )

    def _create_invited_user(self, email: str, display_name: str | None) -> User:
        # 中文注释：受邀成员创建账号时不自动生成个人空间，只保留账号实体并等待邀请绑定工作区。
        now = utc_now()
        effective_name = (display_name or email.split("@")[0]).strip() or "创作者"
        platform_role = ROLE_PLATFORM_SUPER_ADMIN if email in self._platform_super_admin_emails() else None
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            display_name=effective_name,
            auth_provider="email_otp",
            password_hash=None,
            platform_role=platform_role,
            status="active",
            last_login_at=now,
            created_at=now,
            updated_at=now,
        )
        self.user_repository.create(user)
        return self.user_repository.get(user.id) or user

    def _create_user_with_workspace(
        self,
        identifier: str,
        target_type: str,
        display_name: str | None,
        role_code: str,
        organization_name: str | None,
        workspace_name: str,
        use_personal_prefix: bool,
        password: str | None,
        auth_provider: str,
    ) -> User:
        # 中文注释：统一封装公开注册时的“账号 + 组织 + 工作区 + membership”初始化，避免个人/团队两套逻辑分叉。
        now = utc_now()
        effective_name = (display_name or (identifier.split("@")[0] if target_type == "email" else f"用户{identifier[-4:]}")).strip() or "创作者"
        platform_role = ROLE_PLATFORM_SUPER_ADMIN if target_type == "email" and identifier in self._platform_super_admin_emails() else None
        user = User(
            id=str(uuid.uuid4()),
            email=identifier if target_type == "email" else None,
            phone=identifier if target_type == "phone" else None,
            display_name=effective_name,
            auth_provider=auth_provider,
            password_hash=_hash_password(password) if password else None,
            platform_role=platform_role,
            status="active",
            last_login_at=now,
            created_at=now,
            updated_at=now,
        )
        self.user_repository.create(user)

        resolved_organization_name = (organization_name or "").strip()
        if use_personal_prefix:
            resolved_organization_name = f"个人空间 - {effective_name}"
        elif not resolved_organization_name:
            resolved_organization_name = f"{effective_name} 的团队"
        organization = Organization(
            id=str(uuid.uuid4()),
            name=resolved_organization_name,
            slug=_slugify(f"{resolved_organization_name}-{uuid.uuid4().hex[:4]}"),
            status="active",
            created_at=now,
            updated_at=now,
        )
        self.organization_repository.create(organization)

        workspace = Workspace(
            id=str(uuid.uuid4()),
            organization_id=organization.id,
            name=workspace_name,
            slug="default-workspace",
            status="active",
            created_at=now,
            updated_at=now,
        )
        self.workspace_repository.create(workspace)

        default_role = self.role_repository.get_by_code(role_code)
        if default_role is None:
            raise ValueError(f"Default role {role_code} is missing")
        self.membership_repository.create(
            Membership(
                id=str(uuid.uuid4()),
                organization_id=organization.id,
                workspace_id=workspace.id,
                user_id=user.id,
                role_id=default_role.id,
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
        return self.user_repository.get(user.id) or user

    def _validate_password(self, password: str) -> None:
        # 中文注释：密码策略先保持最小约束，确保公开注册和登录链路可用，后续可在这里继续增强复杂度要求。
        if len(password or "") < 6:
            raise ValueError("Password must be at least 6 characters")

    def _ensure_send_code_not_rate_limited(self, normalized_identifier: str, ip_address: str | None) -> None:
        now = utc_now()
        cooldown_seconds = self._send_code_cooldown_seconds()
        latest_identifier_entry = self.auth_rate_limit_repository.get_latest(
            action=AUTH_SEND_CODE_ACTION,
            scope_type="identifier",
            scope_key=normalized_identifier,
        )
        if latest_identifier_entry is not None:
            seconds_since_last_send = (now - _coerce_utc(latest_identifier_entry.created_at)).total_seconds()
            if seconds_since_last_send < cooldown_seconds:
                retry_after_seconds = max(1, math.ceil(cooldown_seconds - seconds_since_last_send))
                raise AuthRateLimitError(
                    f"Too many verification code requests. Please retry in {retry_after_seconds} seconds.",
                    retry_after_seconds=retry_after_seconds,
                )

        hour_window_start = now - timedelta(hours=1)
        identifier_limit = self._identifier_send_limit_per_hour()
        identifier_count = self.auth_rate_limit_repository.count_since(
            action=AUTH_SEND_CODE_ACTION,
            scope_type="identifier",
            scope_key=normalized_identifier,
            since=hour_window_start,
        )
        if identifier_count >= identifier_limit:
            raise AuthRateLimitError(
                "Too many verification code requests for this account. Please try again in one hour.",
                retry_after_seconds=3600,
            )

        normalized_ip = self._normalize_ip(ip_address)
        if normalized_ip:
            ip_limit = self._ip_send_limit_per_hour()
            ip_count = self.auth_rate_limit_repository.count_since(
                action=AUTH_SEND_CODE_ACTION,
                scope_type="ip",
                scope_key=normalized_ip,
                since=hour_window_start,
            )
            if ip_count >= ip_limit:
                raise AuthRateLimitError(
                    "Too many verification code requests from this network. Please try again in one hour.",
                    retry_after_seconds=3600,
                )

    def _record_send_code_rate_limit(self, normalized_identifier: str, ip_address: str | None) -> None:
        now = utc_now()
        self.auth_rate_limit_repository.create(
            AuthRateLimitEntry(
                id=str(uuid.uuid4()),
                action=AUTH_SEND_CODE_ACTION,
                scope_type="identifier",
                scope_key=normalized_identifier,
                created_at=now,
            )
        )
        normalized_ip = self._normalize_ip(ip_address)
        if normalized_ip:
            self.auth_rate_limit_repository.create(
                AuthRateLimitEntry(
                    id=str(uuid.uuid4()),
                    action=AUTH_SEND_CODE_ACTION,
                    scope_type="ip",
                    scope_key=normalized_ip,
                    created_at=now,
                )
            )

    def _consume_verification_code(self, target_type: str, normalized_identifier: str, code: str, purpose: str) -> None:
        latest = self.verification_code_repository.get_latest_active(target_type, normalized_identifier, purpose)
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

    def _normalize_identifier(self, target_type: str, identifier: str) -> str:
        if target_type not in SUPPORTED_AUTH_CHANNELS:
            raise ValueError("Unsupported auth channel")
        normalized = _normalize_email(identifier) if target_type == "email" else _normalize_phone(identifier)
        if not normalized:
            raise ValueError("Identifier is required")
        return normalized

    def _normalize_ip(self, ip_address: str | None) -> str | None:
        if not ip_address:
            return None
        normalized = ip_address.strip()
        return normalized or None

    def _get_user_by_identifier(self, target_type: str, normalized_identifier: str) -> User | None:
        return self.user_repository.get_by_email(normalized_identifier) if target_type == "email" else self.user_repository.get_by_phone(normalized_identifier)

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

    def _resolve_pending_invitation(self, email: str, invitation_id: str | None) -> Invitation | None:
        pending = self.invitation_repository.list_pending_by_email(email)
        if invitation_id:
            return next((item for item in pending if item.id == invitation_id and _coerce_utc(item.expires_at) >= utc_now()), None)
        return next((item for item in pending if _coerce_utc(item.expires_at) >= utc_now()), None)

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

    def _build_captcha_svg(self, code: str) -> str:
        # 中文注释：这里用纯 SVG 直接生成验证码图片，避免再引入图像库依赖，部署和测试都更轻。
        width = 160
        height = 56
        text_nodes: list[str] = []
        for index, char in enumerate(code):
            x = 24 + index * 25
            y = 35 + (index % 2) * 6
            rotation = -16 + index * 8
            color = ["#0f172a", "#1d4ed8", "#0f766e", "#92400e", "#7c2d12"][index % 5]
            text_nodes.append(
                f"<text x='{x}' y='{y}' font-size='28' font-family='monospace' font-weight='700' fill='{color}' transform='rotate({rotation} {x} {y})'>{char}</text>"
            )
        noise_lines = [
            "<line x1='10' y1='14' x2='150' y2='10' stroke='#94a3b8' stroke-width='1.5' opacity='0.45' />",
            "<line x1='18' y1='46' x2='146' y2='20' stroke='#cbd5e1' stroke-width='2' opacity='0.6' />",
            "<line x1='20' y1='24' x2='142' y2='48' stroke='#a5b4fc' stroke-width='1.5' opacity='0.45' />",
        ]
        noise_dots = "".join(
            f"<circle cx='{18 + index * 14}' cy='{18 + (index % 3) * 10}' r='1.8' fill='#cbd5e1' opacity='0.8' />"
            for index in range(8)
        )
        return (
            f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}' role='img' aria-label='captcha'>"
            "<rect width='100%' height='100%' rx='14' fill='#f8fafc' />"
            "<rect x='1.5' y='1.5' width='157' height='53' rx='12.5' fill='none' stroke='#cbd5e1' />"
            f"{''.join(noise_lines)}{noise_dots}{''.join(text_nodes)}"
            "</svg>"
        )

    def _captcha_ttl_seconds(self) -> int:
        return _seconds_from_env("AUTH_CAPTCHA_TTL_SECONDS", CAPTCHA_TTL_SECONDS)

    def _send_code_cooldown_seconds(self) -> int:
        return _seconds_from_env("AUTH_SEND_CODE_COOLDOWN_SECONDS", AUTH_SEND_COOLDOWN_SECONDS)

    def _identifier_send_limit_per_hour(self) -> int:
        return _count_from_env("AUTH_SEND_CODE_LIMIT_PER_IDENTIFIER_PER_HOUR", AUTH_SEND_LIMIT_PER_IDENTIFIER_PER_HOUR)

    def _ip_send_limit_per_hour(self) -> int:
        return _count_from_env("AUTH_SEND_CODE_LIMIT_PER_IP_PER_HOUR", AUTH_SEND_LIMIT_PER_IP_PER_HOUR)

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

    def _send_invitation_email(self, invitation: Invitation) -> None:
        if not self._email_delivery_is_configured():
            return

        organization = self.organization_repository.get(invitation.organization_id)
        workspace = self.workspace_repository.get(invitation.workspace_id)
        role = self.role_repository.get_by_code(invitation.role_code)
        invite_url = self._build_invitation_url(invitation.id)
        expires_at_text = _coerce_utc(invitation.expires_at).strftime("%Y-%m-%d %H:%M UTC")

        smtp_host = get_env("AUTH_EMAIL_SMTP_HOST")
        smtp_port = int(get_env("AUTH_EMAIL_SMTP_PORT", "587") or "587")
        smtp_user = get_env("AUTH_EMAIL_SMTP_USER")
        smtp_password = get_env("AUTH_EMAIL_SMTP_PASSWORD")
        smtp_from = get_env("AUTH_EMAIL_FROM")
        use_ssl = get_env_bool("AUTH_EMAIL_SMTP_SSL", False)
        use_tls = get_env_bool("AUTH_EMAIL_SMTP_TLS", True)

        message = EmailMessage()
        message["From"] = smtp_from
        message["To"] = invitation.email
        message["Subject"] = f"加入 {organization.name if organization else 'DramaLab 团队'} 的工作邀请"
        message.set_content(
            "你好，\n\n"
            "你收到了一个 DramaLab 团队协作邀请。接受后，你可以使用当前邮箱进入对应工作区并参与短剧创作流程。\n\n"
            f"组织：{organization.name if organization else invitation.organization_id}\n"
            f"工作区：{workspace.name if workspace else invitation.workspace_id}\n"
            f"角色：{role.name if role else invitation.role_code}\n\n"
            "加入步骤：\n"
            "1. 打开下面的邀请链接\n"
            "2. 确认组织、工作区和角色信息\n"
            "3. 使用本邮箱接收验证码并完成加入\n\n"
            f"邀请链接：\n{invite_url}\n\n"
            f"有效期至：{expires_at_text}\n\n"
            "如果你不需要加入该团队，可以忽略这封邮件。"
        )

        smtp_cls = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
        with smtp_cls(smtp_host, smtp_port, timeout=20) as server:
            if not use_ssl and use_tls:
                server.starttls()
            if smtp_user and smtp_password:
                server.login(smtp_user, smtp_password)
            server.send_message(message)

    def _build_invitation_url(self, invitation_id: str) -> str:
        base_url = (get_env("AUTH_APP_BASE_URL", "http://localhost:3000") or "http://localhost:3000").strip().rstrip("/")
        return f"{base_url}/invite/{invitation_id}"

    def _encode_jwt(self, payload: dict) -> str:
        header = {"alg": "HS256", "typ": "JWT"}
        header_segment = _b64url_encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        payload_segment = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        signing_input = f"{header_segment}.{payload_segment}"
        secret = (get_env("AUTH_JWT_SECRET", "dramalab-dev-secret") or "dramalab-dev-secret").encode("utf-8")
        signature = hmac.new(secret, signing_input.encode("utf-8"), hashlib.sha256).digest()
        return f"{signing_input}.{_b64url_encode(signature)}"

    def _decode_jwt(self, token: str) -> dict:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Invalid token format")
        header_segment, payload_segment, signature_segment = parts
        signing_input = f"{header_segment}.{payload_segment}"
        secret = (get_env("AUTH_JWT_SECRET", "dramalab-dev-secret") or "dramalab-dev-secret").encode("utf-8")
        expected_signature = _b64url_encode(hmac.new(secret, signing_input.encode("utf-8"), hashlib.sha256).digest())
        if not hmac.compare_digest(expected_signature, signature_segment):
            raise ValueError("Invalid token signature")
        payload = json.loads(_b64url_decode(payload_segment).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(utc_now().timestamp()):
            raise ValueError("Token expired")
        return payload
