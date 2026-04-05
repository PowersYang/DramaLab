"""add series character master columns and project character links

Revision ID: 20260404_01
Revises:
Create Date: 2026-04-04 14:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# 中文注释：当前迁移把系列角色主档能力和分集角色引用层一次补齐，保证新链路可在 PostgreSQL 上正式落表。
revision = "20260404_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """创建系列角色主档字段与分集角色引用表。"""
    op.add_column("characters", sa.Column("canonical_name", sa.String(length=255), nullable=True))
    op.add_column("characters", sa.Column("aliases_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("characters", sa.Column("identity_fingerprint", sa.String(length=255), nullable=True))
    op.add_column("characters", sa.Column("merge_status", sa.String(length=32), nullable=False, server_default="active"))

    op.create_table(
        "project_character_links",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("series_id", sa.String(length=64), nullable=False),
        sa.Column("character_id", sa.String(length=64), nullable=False),
        sa.Column("source_name", sa.String(length=255), nullable=True),
        sa.Column("source_alias", sa.String(length=255), nullable=True),
        sa.Column("episode_notes", sa.Text(), nullable=True),
        sa.Column("override_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("match_confidence", sa.Float(), nullable=True),
        sa.Column("match_status", sa.String(length=32), nullable=False, server_default="confirmed"),
        sa.Column("organization_id", sa.String(length=64), nullable=True),
        sa.Column("workspace_id", sa.String(length=64), nullable=True),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["character_id"], ["characters.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index("ix_project_character_links_project", "project_character_links", ["project_id"], unique=False)
    op.create_index("ix_project_character_links_character", "project_character_links", ["character_id"], unique=False)
    op.create_index("ix_project_character_links_series_status", "project_character_links", ["series_id", "match_status"], unique=False)
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_characters_series_canonical_name_active
        ON characters (owner_id, canonical_name)
        WHERE owner_type = 'series' AND is_deleted = false AND canonical_name IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_project_character_links_project_character_active
        ON project_character_links (project_id, character_id)
        WHERE is_deleted = false
        """
    )


def downgrade() -> None:
    """回滚系列角色主档字段与分集角色引用表。"""
    op.execute("DROP INDEX IF EXISTS ux_project_character_links_project_character_active")
    op.execute("DROP INDEX IF EXISTS ux_characters_series_canonical_name_active")
    op.drop_index("ix_project_character_links_series_status", table_name="project_character_links")
    op.drop_index("ix_project_character_links_character", table_name="project_character_links")
    op.drop_index("ix_project_character_links_project", table_name="project_character_links")
    op.drop_table("project_character_links")
    op.drop_column("characters", "merge_status")
    op.drop_column("characters", "identity_fingerprint")
    op.drop_column("characters", "aliases_json")
    op.drop_column("characters", "canonical_name")
