"""add asset prompt state table

Revision ID: 20260405_01
Revises: 20260404_01
Create Date: 2026-04-05 22:40:00
"""

from alembic import op
import sqlalchemy as sa


# 中文注释：为角色/场景/道具的图像与动态提示词提供统一真源，避免各弹窗分散存储造成回填不一致。
revision = "20260405_01"
down_revision = "20260404_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """创建素材提示词状态表。"""
    op.create_table(
        "asset_prompt_states",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_scope", sa.String(length=32), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("asset_type", sa.String(length=32), nullable=False),
        sa.Column("asset_id", sa.String(length=64), nullable=False),
        sa.Column("output_type", sa.String(length=32), nullable=False),
        sa.Column("slot_type", sa.String(length=32), nullable=False, server_default="default"),
        sa.Column("positive_prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column("negative_prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="user_input"),
        sa.Column("organization_id", sa.String(length=64), nullable=True),
        sa.Column("workspace_id", sa.String(length=64), nullable=True),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_scope",
            "owner_id",
            "asset_type",
            "asset_id",
            "output_type",
            "slot_type",
            name="uq_asset_prompt_states_scope_asset_slot",
        ),
    )
    op.create_index(
        "ix_asset_prompt_states_owner_asset",
        "asset_prompt_states",
        ["owner_scope", "owner_id", "asset_type", "asset_id", "output_type", "updated_at"],
        unique=False,
    )


def downgrade() -> None:
    """回滚素材提示词状态表。"""
    op.drop_index("ix_asset_prompt_states_owner_asset", table_name="asset_prompt_states")
    op.drop_table("asset_prompt_states")
