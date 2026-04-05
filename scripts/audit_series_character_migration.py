#!/usr/bin/env python3
"""
系列角色迁移审计脚本。

默认只读，输出系列维度的迁移准备度摘要，不直接改库。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.application.services import SeriesCharacterMigrationService  # noqa: E402
from src.settings.env_settings import override_env_path_for_tests  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit series migration readiness for shared characters")
    parser.add_argument("--series-id", help="Audit one target series only")
    parser.add_argument("--workspace-id", help="Only scan series inside one workspace")
    parser.add_argument("--env-file", default=str(BACKEND_DIR / ".env"), help="Backend env file path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    override_env_path_for_tests(Path(args.env_file).resolve())
    service = SeriesCharacterMigrationService()
    payload = (
        service.build_series_audit(args.series_id)
        if args.series_id
        else {"series_audits": service.list_series_audits(workspace_id=args.workspace_id)}
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
