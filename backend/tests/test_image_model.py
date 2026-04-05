import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


class WanxImageModelTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.ref_path = Path(self.temp_dir.name) / "ref.png"
        self.ref_path.write_bytes(b"fake-image")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_wan26_image_rejects_empty_signed_reference_url_before_request(self):
        from src.models.image import WanxImageModel

        model = WanxImageModel({})
        uploader = Mock()
        uploader.is_configured = True
        uploader.upload_file.return_value = "dramalab/temp/ref_images/ref.png"
        uploader.sign_url_for_api.return_value = ""

        with patch("src.models.image.OSSImageUploader", return_value=uploader), patch(
            "src.models.image.requests.post"
        ) as mock_post, patch(
            "src.models.image.ModelProviderService.get_provider_credential",
            return_value="test-key",
        ), patch(
            "src.models.image.get_provider_base_url",
            return_value="https://dashscope.example.com",
        ), patch(
            "src.models.image.ModelProviderService.require_model_setting",
            side_effect=["/image/create", "/tasks/{task_id}"],
        ), patch(
            "src.models.image.ModelProviderService.build_provider_url",
            return_value="https://dashscope.example.com/api",
        ):
            with self.assertRaisesRegex(RuntimeError, "Reference image URL is unavailable"):
                model._generate_wan26_image_http(
                    prompt="headshot",
                    size="1024*1024",
                    n=1,
                    ref_image_paths=[str(self.ref_path)],
                )

        mock_post.assert_not_called()

    def test_normalize_reference_image_url_for_api_accepts_https_url(self):
        from src.models.image import WanxImageModel

        model = WanxImageModel({})

        normalized = model._normalize_reference_image_url_for_api("https://example.com/ref.png")

        self.assertEqual(normalized, "https://example.com/ref.png")

if __name__ == "__main__":
    unittest.main()
