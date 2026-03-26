from pathlib import Path
import unittest


class EnvSettingsPathTest(unittest.TestCase):
    def test_get_env_path_points_to_backend_root_env_in_dev_mode(self):
        from src.settings.env_settings import get_env_path, override_env_path_for_tests

        override_env_path_for_tests(None)
        expected = Path(__file__).resolve().parent.parent / ".env"
        self.assertEqual(get_env_path(), expected)
