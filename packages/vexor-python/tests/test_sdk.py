"""Tests for Vexor Python SDK."""

import hashlib
import hmac
import io
import json
import os
import unittest
from unittest.mock import MagicMock, patch

from vexor_video import (
    Vexor,
    Webhooks,
    VexorError,
    AuthenticationError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    SignatureVerificationError,
)


class TestWebhooks(unittest.TestCase):
    def setUp(self):
        self.secret = "whsec_test_secret_12345"
        self.payload = '{"event_id":"evt_123","type":"video.asset.ready","asset_id":"ast_abc","account_id":"acct_123","timestamp":"2026-11-05T00:00:00Z","data":{"id":"ast_abc"}}'
        self.raw_bytes = self.payload.encode("utf-8")
        self.sig = hmac.new(self.secret.encode("utf-8"), self.raw_bytes, hashlib.sha256).hexdigest()

    def test_verify_valid_signature_raw_hex(self):
        wh = Webhooks(secret=self.secret)
        self.assertTrue(wh.verify_signature(self.payload, self.sig))
        self.assertTrue(wh.verify_signature(self.raw_bytes, self.sig))

    def test_verify_valid_signature_prefixed(self):
        wh = Webhooks(secret=self.secret)
        self.assertTrue(wh.verify_signature(self.payload, f"sha256={self.sig}"))

    def test_verify_invalid_signature(self):
        wh = Webhooks(secret=self.secret)
        self.assertFalse(wh.verify_signature(self.payload, "invalid_signature"))

    def test_verify_wrong_secret(self):
        wh = Webhooks(secret="wrong_secret")
        self.assertFalse(wh.verify_signature(self.payload, self.sig))

    def test_construct_event_success(self):
        wh = Webhooks(secret=self.secret)
        event = wh.construct_event(self.payload, self.sig)
        self.assertEqual(event["type"], "video.asset.ready")
        self.assertEqual(event["asset_id"], "ast_abc")

    def test_construct_event_invalid_signature_raises(self):
        wh = Webhooks(secret=self.secret)
        with self.assertRaises(SignatureVerificationError):
            wh.construct_event(self.payload, "bad_signature")

    def test_class_methods(self):
        self.assertTrue(Webhooks.verify(self.payload, self.sig, self.secret))
        event = Webhooks.construct(self.payload, self.sig, self.secret)
        self.assertEqual(event["type"], "video.asset.ready")


class TestClientConfig(unittest.TestCase):
    def test_env_var_fallback(self):
        with patch.dict(os.environ, {
            "VEXOR_API_KEY": "env_api_key",
            "VEXOR_BASE_URL": "http://127.0.0.1:8080/",
            "VEXOR_WEBHOOK_SECRET": "env_secret",
        }):
            client = Vexor()
            self.assertEqual(client.api_key, "env_api_key")
            self.assertEqual(client.base_url, "http://127.0.0.1:8080")
            self.assertEqual(client.webhooks.default_secret, "env_secret")

    def test_explicit_args_override_env(self):
        with patch.dict(os.environ, {"VEXOR_API_KEY": "env_api_key"}):
            client = Vexor(api_key="explicit_key", base_url="https://custom.local")
            self.assertEqual(client.api_key, "explicit_key")
            self.assertEqual(client.base_url, "https://custom.local")


class TestErrorHandling(unittest.TestCase):
    def test_error_hierarchy(self):
        self.assertTrue(issubclass(AuthenticationError, VexorError))
        self.assertTrue(issubclass(NotFoundError, VexorError))
        self.assertTrue(issubclass(ConflictError, VexorError))
        self.assertTrue(issubclass(RateLimitError, VexorError))
        self.assertTrue(issubclass(SignatureVerificationError, VexorError))

    def test_error_attributes(self):
        err = ConflictError("asset still transcoding", status_code=409, response_body='{"code":"CONFLICT"}')
        self.assertEqual(err.status_code, 409)
        self.assertEqual(err.response_body, '{"code":"CONFLICT"}')
        self.assertIn("still transcoding", str(err))


class TestAssetSourceResolution(unittest.TestCase):
    def test_bytes_source(self):
        client = Vexor(api_key="test")
        data = b"fake-video-content-12345"
        f_obj, size, name = client.assets._resolve_file_source(data, filename="my_sample.mp4")
        self.assertEqual(size, len(data))
        self.assertEqual(name, "my_sample.mp4")
        self.assertEqual(f_obj.read(), data)

    def test_file_like_source(self):
        client = Vexor(api_key="test")
        buf = io.BytesIO(b"sample-buffer")
        f_obj, size, name = client.assets._resolve_file_source(buf, filename="video.mp4")
        self.assertEqual(size, 13)
        self.assertEqual(name, "video.mp4")


class TestStorageImport(unittest.TestCase):
    def test_optional_output_connection_is_sent(self):
        client = Vexor(api_key="test")
        client.request = MagicMock(return_value={"data": {"id": "asset-1"}})

        asset = client.assets.import_from_storage(
            "source-connection", "lesson.mp4", output_connection_id="output-connection"
        )

        self.assertEqual(asset["id"], "asset-1")
        client.request.assert_called_once_with(
            "POST",
            "/v1/assets/imports",
            json_data={
                "connection_id": "source-connection",
                "object_key": "lesson.mp4",
                "output_connection_id": "output-connection",
            },
        )

    def test_blank_output_connection_is_rejected(self):
        client = Vexor(api_key="test")
        with self.assertRaises(ValueError):
            client.assets.import_from_storage("source-connection", "lesson.mp4", output_connection_id=" ")


if __name__ == "__main__":
    unittest.main()
