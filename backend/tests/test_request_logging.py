import json
import unittest

from fastapi import Request

from src.common.request_logging import _extract_safe_headers, _parse_request_payload, _sanitize_value


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
            "path": "/model-providers/OPENAI",
            "headers": [(b"content-type", b"application/json")],
            "query_string": b"",
        }
        request = Request(scope)
        body = json.dumps({"POSTGRES_PASSWORD": "pwd", "POSTGRES_SCHEMA": "duanju_dev"}).encode("utf-8")

        self.assertEqual(
            _parse_request_payload(request, body),
            {"POSTGRES_PASSWORD": "***", "POSTGRES_SCHEMA": "duanju_dev"},
        )

    def test_extract_safe_headers_keeps_debug_headers_and_masks_sensitive_ones(self):
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/projects",
            "headers": [
                (b"user-agent", b"pytest"),
                (b"x-request-id", b"trace-123"),
                (b"authorization", b"Bearer secret"),
            ],
            "query_string": b"",
        }
        request = Request(scope)

        self.assertEqual(
            _extract_safe_headers(request),
            {
                "user-agent": "pytest",
                "x-request-id": "trace-123",
                "authorization": "***",
            },
        )
