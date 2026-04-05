#!/usr/bin/env python3
"""
系列项目角色历史归并辅助脚本。

默认只做 dry-run，输出候选重复角色分组，不直接改库。
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
    parser = argparse.ArgumentParser(description="Scan duplicate project-level characters inside a series")
    parser.add_argument("--series-id", required=True, help="Target series id")
    parser.add_argument("--env-file", default=str(BACKEND_DIR / ".env"), help="Backend env file path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    override_env_path_for_tests(Path(args.env_file).resolve())
    candidates = SeriesCharacterMigrationService().build_candidate_groups(args.series_id)
    print(json.dumps({
        "series_id": args.series_id,
        "candidate_group_count": len(candidates),
        "candidates": candidates,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
