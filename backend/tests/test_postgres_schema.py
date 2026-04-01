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
                "DATABASE_URL=postgresql+psycopg://tester:secret@localhost:5432/dramalab\n",
                encoding="utf-8",
            )
            override_env_path_for_tests(env_path)
            self.assertEqual(
                _get_database_url(),
                "postgresql+psycopg://tester:secret@localhost:5432/dramalab",
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
                    "POSTGRES_DB=dramalab",
                    "POSTGRES_USER=app",
                    "POSTGRES_PASSWORD=pwd",
                    "",
                ]),
                encoding="utf-8",
            )
            override_env_path_for_tests(env_path)
            self.assertEqual(
                _get_database_url(),
                "postgresql+psycopg://app:pwd@db.internal:5433/dramalab",
            )
            override_env_path_for_tests(None)

    def test_configure_postgres_connection_sets_search_path_and_beijing_timezone(self):
        from src.db.session import _configure_postgres_connection

        statements: list[str] = []

        class _FakeCursor:
            def execute(self, sql: str) -> None:
                statements.append(sql)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        class _FakeConnection:
            def cursor(self):
                return _FakeCursor()

        _configure_postgres_connection(_FakeConnection(), schema="duanju_dev")
        self.assertEqual(
            statements,
            [
                'SET search_path TO "duanju_dev", public',
                "SET TIME ZONE 'Asia/Shanghai'",
            ],
        )

    def test_configure_postgres_connection_sets_beijing_timezone_without_schema(self):
        from src.db.session import _configure_postgres_connection

        statements: list[str] = []

        class _FakeCursor:
            def execute(self, sql: str) -> None:
                statements.append(sql)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        class _FakeConnection:
            def cursor(self):
                return _FakeCursor()

        _configure_postgres_connection(_FakeConnection(), schema=None)
        self.assertEqual(statements, ["SET TIME ZONE 'Asia/Shanghai'"])


class PostgresSchemaSqlTest(unittest.TestCase):
    def test_schema_sql_uses_varchar_primary_keys_and_jsonb(self):
        sql_path = Path(__file__).resolve().parent.parent / "scripts" / "postgres_schema.sql"
        sql = sql_path.read_text(encoding="utf-8")
        self.assertIn("create table if not exists style_presets", sql)
        self.assertIn("create table if not exists user_art_styles", sql)
        self.assertIn("create table if not exists model_provider_configs", sql)
        self.assertIn("create table if not exists model_catalog_entries", sql)
        self.assertIn("create table if not exists projects", sql)
        self.assertIn("create table if not exists series", sql)
        self.assertIn("id varchar(64) primary key", sql)
        self.assertIn("model_settings jsonb not null default '{}'::jsonb", sql)
        self.assertIn("timeline_json jsonb", sql)
        self.assertIn("status varchar(32) not null default 'pending'", sql)
        self.assertIn("status varchar(32) not null default 'active'", sql)
        self.assertIn("reference_video_urls jsonb not null default '[]'::jsonb", sql)
        self.assertIn("positive_prompt text not null", sql)
        self.assertIn("negative_prompt text not null default ''", sql)
        self.assertIn("sort_order integer not null default 0", sql)
        self.assertIn("is_deleted boolean not null default false", sql)
        self.assertIn("deleted_at timestamptz", sql)
        self.assertIn("version integer not null default 1", sql)
        self.assertIn("create index if not exists ix_style_presets_active_sort on style_presets (is_active, sort_order, created_at)", sql)
        self.assertIn("create index if not exists ix_user_art_styles_user_sort on user_art_styles (user_id, sort_order, updated_at)", sql)
        self.assertIn(
            "create unique index if not exists ux_character_asset_units_character_unit_type on character_asset_units (character_id, unit_type) where is_deleted = false",
            sql,
        )
        self.assertIn(
            "create index if not exists ix_projects_org_workspace_updated on projects (organization_id, workspace_id, is_deleted, updated_at)",
            sql,
        )
        self.assertIn(
            "create index if not exists ix_series_org_workspace_updated on series (organization_id, workspace_id, is_deleted, updated_at)",
            sql,
        )

    def test_init_database_backfills_project_status_and_timeline_columns_for_legacy_sqlite(self):
        from sqlalchemy import create_engine, inspect, text

        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database

        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "legacy-projects.db"
            env_path = Path(temp_dir) / ".env"
            env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

            override_env_path_for_tests(env_path)
            get_engine.cache_clear()
            get_session_factory.cache_clear()

            legacy_engine = create_engine(f"sqlite:///{db_path}", future=True)
            with legacy_engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        CREATE TABLE projects (
                            id VARCHAR(64) PRIMARY KEY,
                            organization_id VARCHAR(64),
                            workspace_id VARCHAR(64),
                            title VARCHAR(255) NOT NULL,
                            original_text TEXT NOT NULL,
                            style_preset VARCHAR(128) NOT NULL DEFAULT 'realistic',
                            style_prompt TEXT,
                            merged_video_url TEXT,
                            series_id VARCHAR(64),
                            episode_number INTEGER,
                            art_direction JSON,
                            model_settings JSON NOT NULL DEFAULT '{}',
                            prompt_config JSON NOT NULL DEFAULT '{}',
                            is_deleted BOOLEAN NOT NULL DEFAULT 0,
                            deleted_at DATETIME,
                            deleted_by VARCHAR(64),
                            created_by VARCHAR(64),
                            updated_by VARCHAR(64),
                            created_at DATETIME NOT NULL,
                            updated_at DATETIME NOT NULL,
                            version INTEGER NOT NULL DEFAULT 1
                        )
                        """
                    )
                )

            init_database()

            columns = {column["name"] for column in inspect(get_engine()).get_columns("projects")}
            self.assertIn("timeline_json", columns)
            self.assertIn("status", columns)

            override_env_path_for_tests(None)

    def test_init_database_backfills_series_status_for_legacy_sqlite(self):
        from sqlalchemy import create_engine, inspect, text

        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database

        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "legacy-series.db"
            env_path = Path(temp_dir) / ".env"
            env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

            override_env_path_for_tests(env_path)
            get_engine.cache_clear()
            get_session_factory.cache_clear()

            legacy_engine = create_engine(f"sqlite:///{db_path}", future=True)
            with legacy_engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        CREATE TABLE series (
                            id VARCHAR(64) PRIMARY KEY,
                            organization_id VARCHAR(64),
                            workspace_id VARCHAR(64),
                            title VARCHAR(255) NOT NULL,
                            description TEXT,
                            art_direction JSON,
                            model_settings JSON NOT NULL DEFAULT '{}',
                            prompt_config JSON NOT NULL DEFAULT '{}',
                            is_deleted BOOLEAN NOT NULL DEFAULT 0,
                            deleted_at DATETIME,
                            deleted_by VARCHAR(64),
                            created_by VARCHAR(64),
                            updated_by VARCHAR(64),
                            created_at DATETIME NOT NULL,
                            updated_at DATETIME NOT NULL,
                            version INTEGER NOT NULL DEFAULT 1
                        )
                        """
                    )
                )

            init_database()

            columns = {column["name"] for column in inspect(get_engine()).get_columns("series")}
            self.assertIn("status", columns)

            override_env_path_for_tests(None)
            get_engine.cache_clear()
            get_session_factory.cache_clear()

    def test_init_database_migrates_legacy_style_library_rows_into_style_records(self):
        from sqlalchemy import create_engine, text

        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database

        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "legacy-style-library.db"
            env_path = Path(temp_dir) / ".env"
            env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

            override_env_path_for_tests(env_path)
            get_engine.cache_clear()
            get_session_factory.cache_clear()

            legacy_engine = create_engine(f"sqlite:///{db_path}", future=True)
            with legacy_engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        CREATE TABLE users (
                            id VARCHAR(64) PRIMARY KEY,
                            email VARCHAR(255),
                            phone VARCHAR(32),
                            display_name VARCHAR(255),
                            auth_provider VARCHAR(64) NOT NULL DEFAULT 'email_otp',
                            password_hash VARCHAR(512),
                            platform_role VARCHAR(64),
                            status VARCHAR(32) NOT NULL DEFAULT 'active',
                            last_login_at DATETIME,
                            created_at DATETIME NOT NULL,
                            updated_at DATETIME NOT NULL
                        )
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        CREATE TABLE user_art_style_libraries (
                            id VARCHAR(64) PRIMARY KEY,
                            user_id VARCHAR(64) NOT NULL,
                            styles_json JSON NOT NULL DEFAULT '[]',
                            created_at DATETIME NOT NULL,
                            updated_at DATETIME NOT NULL
                        )
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        INSERT INTO users (id, email, auth_provider, status, created_at, updated_at)
                        VALUES ('user_legacy_1', 'legacy@example.com', 'email_otp', 'active', '2026-01-01 00:00:00', '2026-01-01 00:00:00')
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        INSERT INTO user_art_style_libraries (id, user_id, styles_json, created_at, updated_at)
                        VALUES (
                            'library_1',
                            'user_legacy_1',
                            '[{"id":"legacy-style","name":"Legacy Style","positive_prompt":"ink","negative_prompt":"blur"}]',
                            '2026-01-01 00:00:00',
                            '2026-01-01 00:00:00'
                        )
                        """
                    )
                )

            init_database()

            with get_engine().begin() as connection:
                row = connection.execute(
                    text("SELECT id, user_id, name, positive_prompt, negative_prompt FROM user_art_styles WHERE user_id = 'user_legacy_1'")
                ).one()

            self.assertEqual(row[0], "legacy-style")
            self.assertEqual(row[1], "user_legacy_1")
            self.assertEqual(row[2], "Legacy Style")
            self.assertEqual(row[3], "ink")
            self.assertEqual(row[4], "blur")

            override_env_path_for_tests(None)
            get_engine.cache_clear()
            get_session_factory.cache_clear()
