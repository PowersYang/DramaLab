import tempfile
import unittest
from pathlib import Path


class PostgresStorageConfigurationTest(unittest.TestCase):
    def test_database_url_prefers_explicit_env(self):
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import _get_database_url

        with tempfile.TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_path.write_text(
                "DATABASE_URL=postgresql+psycopg://tester:secret@localhost:5432/lumenx\n",
                encoding="utf-8",
            )
            override_env_path_for_tests(env_path)
            self.assertEqual(
                _get_database_url(),
                "postgresql+psycopg://tester:secret@localhost:5432/lumenx",
            )
            override_env_path_for_tests(None)

    def test_database_url_supports_postgres_env_parts(self):
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import _get_database_url

        with tempfile.TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_path.write_text(
                "\n".join([
                    "POSTGRES_HOST=db.internal",
                    "POSTGRES_PORT=5433",
                    "POSTGRES_DB=lumenx",
                    "POSTGRES_USER=app",
                    "POSTGRES_PASSWORD=pwd",
                    "",
                ]),
                encoding="utf-8",
            )
            override_env_path_for_tests(env_path)
            self.assertEqual(
                _get_database_url(),
                "postgresql+psycopg://app:pwd@db.internal:5433/lumenx",
            )
            override_env_path_for_tests(None)


class PostgresSchemaSqlTest(unittest.TestCase):
    def test_schema_sql_uses_varchar_primary_keys_and_jsonb(self):
        sql_path = Path(__file__).resolve().parent.parent / "scripts" / "postgres_schema.sql"
        sql = sql_path.read_text(encoding="utf-8")
        self.assertIn("create table if not exists projects", sql)
        self.assertIn("id varchar(64) primary key", sql)
        self.assertIn("model_settings jsonb not null default '{}'::jsonb", sql)
        self.assertIn("reference_video_urls jsonb not null default '[]'::jsonb", sql)
        self.assertIn("is_deleted boolean not null default false", sql)
        self.assertIn("deleted_at timestamptz", sql)
        self.assertIn("version integer not null default 1", sql)
        self.assertIn(
            "create unique index if not exists ux_character_asset_units_character_unit_type on character_asset_units (character_id, unit_type) where is_deleted = false",
            sql,
        )
        self.assertIn(
            "create index if not exists ix_projects_org_workspace_updated on projects (organization_id, workspace_id, is_deleted, updated_at)",
            sql,
        )
