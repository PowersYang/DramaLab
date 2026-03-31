import unittest
from tempfile import NamedTemporaryFile


class AssetImageProviderTest(unittest.TestCase):
    def test_resolve_reference_image_input_preserves_http_urls(self):
        from src.utils.reference_inputs import resolve_reference_image_input

        reference_url = "https://example.com/assets/hero-fullbody.png"

        self.assertEqual(resolve_reference_image_input(reference_url), reference_url)

    def test_resolve_reference_image_input_preserves_object_keys(self):
        from src.utils.reference_inputs import resolve_reference_image_input

        object_key = "comic_gen/assets/characters/hero-fullbody.png"

        self.assertEqual(resolve_reference_image_input(object_key), object_key)

    def test_resolve_reference_image_input_preserves_existing_local_temp_files(self):
        from src.utils.reference_inputs import resolve_reference_image_input

        with NamedTemporaryFile(suffix=".png") as temp_file:
            self.assertEqual(resolve_reference_image_input(temp_file.name), temp_file.name)

    def test_resolve_reference_image_input_rejects_unknown_relative_paths(self):
        from src.utils.reference_inputs import resolve_reference_image_input

        self.assertIsNone(resolve_reference_image_input("assets/characters/hero-fullbody.png"))


if __name__ == "__main__":
    unittest.main()
