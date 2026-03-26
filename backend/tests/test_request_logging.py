import json
import unittest

from fastapi import Request

from src.common.request_logging import _parse_request_payload, _sanitize_value


class RequestLoggingTest(unittest.TestCase):
    def test_sanitize_value_masks_sensitive_keys(self):
        payload = {
            "name": "demo",
            "password": "secret",
            "nested": {"api_key": "abc", "tokenValue": "xyz"},
        }

        self.assertEqual(
            _sanitize_value(payload),
            {
                "name": "demo",
                "password": "***",
                "nested": {"api_key": "***", "tokenValue": "***"},
            },
        )

    def test_parse_request_payload_reads_json_and_masks_sensitive_fields(self):
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/config/env",
            "headers": [(b"content-type", b"application/json")],
            "query_string": b"",
        }
        request = Request(scope)
        body = json.dumps({"POSTGRES_PASSWORD": "pwd", "POSTGRES_SCHEMA": "duanju_dev"}).encode("utf-8")

        self.assertEqual(
            _parse_request_payload(request, body),
            {"POSTGRES_PASSWORD": "***", "POSTGRES_SCHEMA": "duanju_dev"},
        )
