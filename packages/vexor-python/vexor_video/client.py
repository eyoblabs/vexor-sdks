"""Vexor API Client."""

import json
import math
import os
import urllib.error
import urllib.parse
import urllib.request
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from urllib.request import HTTPRedirectHandler
from typing import Any, Dict, Optional, Union

from .assets import Assets
from .errors import (
    AuthenticationError,
    ConflictError,
    NotFoundError,
    PermissionError,
    RateLimitError,
    VexorError,
)
from .tokens import Tokens
from .webhooks import Webhooks
from .storage_connections import StorageConnections


class _RejectRedirects(HTTPRedirectHandler):
    """Prevent authenticated API requests from forwarding credentials to redirects."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class RawResponse:
    """Wrapper for raw HTTP responses."""

    def __init__(self, status_code: int, headers: Any, body: bytes):
        self.status_code = status_code
        self.headers = headers
        self.body = body

    def json(self) -> Any:
        if not self.body:
            return None
        return json.loads(self.body.decode("utf-8"))


class Vexor:
    """Official Vexor client for video uploads, asset management, and tokenized playback."""

    DEFAULT_BASE_URL = "https://api.vexor.et"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        webhook_secret: Optional[str] = None,
        timeout: float = 30.0,
    ):
        configured_api_key = api_key if api_key is not None else os.environ.get("VEXOR_API_KEY")
        if not isinstance(configured_api_key, str) or not configured_api_key.strip():
            raise ValueError("Provide api_key or set VEXOR_API_KEY for authenticated API requests")
        self.api_key = configured_api_key.strip()
        raw_base_url = (
            base_url
            or os.environ.get("VEXOR_BASE_URL")
            or os.environ.get("VEXOR_API_BASE_URL")
            or self.DEFAULT_BASE_URL
        )
        self.base_url = self._normalize_base_url(raw_base_url)
        self.webhook_secret = webhook_secret or os.environ.get("VEXOR_WEBHOOK_SECRET")
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("timeout must be a positive finite number of seconds")
        self.timeout = timeout

        self.assets = Assets(self)
        self.tokens = Tokens(self)
        self.webhooks = Webhooks(secret=self.webhook_secret)
        self.storage_connections = StorageConnections(self)

    @staticmethod
    def _normalize_base_url(raw_url: str) -> str:
        try:
            parsed = urllib.parse.urlsplit(raw_url)
            hostname = parsed.hostname
            # Accessing .port validates malformed and out-of-range ports.
            parsed.port
        except (TypeError, ValueError):
            raise ValueError("VEXOR base URL must be a valid absolute HTTP(S) URL")

        if not hostname or parsed.scheme not in ("https", "http"):
            raise ValueError("VEXOR base URL must be a valid absolute HTTP(S) URL")
        local_hosts = {"localhost", "127.0.0.1", "::1"}
        if parsed.scheme != "https" and hostname.lower() not in local_hosts:
            raise ValueError("VEXOR base URL must use HTTPS except for localhost development")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("VEXOR base URL cannot contain credentials, query parameters, or a fragment")
        return urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc, parsed.path.rstrip("/"), "", ""))

    @staticmethod
    def _effective_port(parsed: urllib.parse.SplitResult) -> Optional[int]:
        if parsed.port is not None:
            return parsed.port
        return 443 if parsed.scheme.lower() == "https" else 80

    def _default_headers(self) -> Dict[str, str]:
        headers = {
            "User-Agent": "vexor-python/0.1.0",
            "Accept": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def request_raw(
        self,
        method: str,
        path_or_url: str,
        headers: Optional[Dict[str, str]] = None,
        body: Optional[Union[bytes, str]] = None,
        timeout: Optional[float] = None,
    ) -> RawResponse:
        """Execute a raw HTTP request against the Vexor API or upload endpoint."""
        if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
            target = urllib.parse.urlsplit(path_or_url)
            configured = urllib.parse.urlsplit(self.base_url)
            if (
                target.scheme.lower() != configured.scheme.lower()
                or (target.hostname or "").lower() != (configured.hostname or "").lower()
                or self._effective_port(target) != self._effective_port(configured)
                or target.username
                or target.password
            ):
                raise ValueError("VEXOR upload URLs must use the configured API origin")
            url = path_or_url
        else:
            url = f"{self.base_url}/{path_or_url.lstrip('/')}"

        req_headers = self._default_headers()
        if headers:
            req_headers.update(headers)

        data = body
        if isinstance(data, str):
            data = data.encode("utf-8")

        req = urllib.request.Request(url, data=data, headers=req_headers, method=method.upper())
        req_timeout = timeout if timeout is not None else self.timeout
        if isinstance(req_timeout, bool) or not isinstance(req_timeout, (int, float)) or not math.isfinite(req_timeout) or req_timeout <= 0:
            raise ValueError("timeout must be a positive finite number of seconds")

        try:
            opener = urllib.request.build_opener(_RejectRedirects())
            with opener.open(req, timeout=req_timeout) as resp:
                resp_body = resp.read()
                return RawResponse(resp.status, resp.headers, resp_body)
        except urllib.error.HTTPError as e:
            err_body = e.read()
            msg = self._extract_error_message(err_body, e.code, e.reason)
            decoded_body = err_body.decode("utf-8", "replace")
            if e.code == 401:
                raise AuthenticationError(msg, status_code=401, response_body=decoded_body)
            elif e.code == 403:
                raise PermissionError(msg, status_code=403, response_body=decoded_body)
            elif e.code == 404:
                raise NotFoundError(msg, status_code=404, response_body=decoded_body)
            elif e.code == 409:
                raise ConflictError(msg, status_code=409, response_body=decoded_body)
            elif e.code == 429:
                raise RateLimitError(
                    msg,
                    status_code=429,
                    response_body=decoded_body,
                    retry_after_seconds=self._retry_after_seconds(
                        e.headers.get("Retry-After") if e.headers else None
                    ),
                )
            else:
                raise VexorError(msg, status_code=e.code, response_body=decoded_body)
        except urllib.error.URLError as e:
            raise VexorError(f"Connection failed: {e.reason}") from e

    def request(
        self,
        method: str,
        path_or_url: str,
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Any] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Any:
        """Execute an API request, automatically serializing and deserializing JSON."""
        req_headers = {}
        if headers:
            req_headers.update(headers)

        body = None
        if json_data is not None:
            body = json.dumps(json_data).encode("utf-8")
            req_headers["Content-Type"] = "application/json"

        url = path_or_url
        if params:
            query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}{query}"

        res = self.request_raw(method, url, headers=req_headers, body=body, timeout=timeout)
        if not res.body:
            return None
        try:
            return json.loads(res.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise VexorError(
                "Vexor returned an invalid JSON response.",
                status_code=res.status_code,
                response_body=res.body.decode("utf-8", "replace"),
            ) from error

    @staticmethod
    def _retry_after_seconds(value: Optional[str]) -> Optional[int]:
        if not value:
            return None
        try:
            return max(0, int(value.strip()))
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(value)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                return max(0, int((retry_at - datetime.now(timezone.utc)).total_seconds()))
            except (TypeError, ValueError, OverflowError):
                return None

    @staticmethod
    def _extract_error_message(body: bytes, status_code: int, default_reason: str) -> str:
        if not body:
            return f"HTTP {status_code}: {default_reason}"
        try:
            data = json.loads(body.decode("utf-8"))
            if isinstance(data, dict):
                err = data.get("error")
                if isinstance(err, dict):
                    return err.get("message") or err.get("code") or str(err)
                if isinstance(err, str):
                    return err
                if "message" in data:
                    return str(data["message"])
        except Exception:
            pass
        return f"HTTP {status_code}: {body.decode('utf-8', 'replace').strip()}"
