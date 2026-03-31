import unittest

from src.utils.oss_utils import expose_oss_urls_in_data, is_object_key


class _StubUploader:
    is_configured = True

    def public_url_for_display(self, object_key: str) -> str:
        return f"https://cdn.example.com/{object_key}"


class OssUtilsTest(unittest.TestCase):
    def test_is_object_key_accepts_current_and_historical_prefixed_media_paths(self):
        self.assertTrue(is_object_key("comic_gen/assets/characters/demo.png"))
        self.assertTrue(is_object_key("dramalab/video/tasks/demo.mp4"))
        self.assertFalse(is_object_key("assets/characters/demo.png"))
        self.assertFalse(is_object_key("https://cdn.example.com/comic_gen/assets/characters/demo.png"))

    def test_expose_oss_urls_in_data_converts_historical_object_keys(self):
        data = {
            "image_url": "dramalab/assets/characters/demo.png",
            "video_url": "legacy/video/tasks/demo.mp4",
            "local_path": "assets/characters/local.png",
        }

        converted = expose_oss_urls_in_data(data, _StubUploader())

        self.assertEqual(converted["image_url"], "https://cdn.example.com/dramalab/assets/characters/demo.png")
        self.assertEqual(converted["video_url"], "https://cdn.example.com/legacy/video/tasks/demo.mp4")
        self.assertEqual(converted["local_path"], "assets/characters/local.png")


if __name__ == "__main__":
    unittest.main()
