"""Exceptions for the Vexor Python SDK."""

from typing import Optional

class VexorError(Exception):
    """Base exception for all Vexor API errors."""

    def __init__(self, message: str, status_code: Optional[int] = None, response_body: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.response_body = response_body


class AuthenticationError(VexorError):
    """Raised when an API key is missing, malformed, or invalid (HTTP 401)."""


class PermissionError(VexorError):
    """Raised when the API key is valid but lacks permission (HTTP 403)."""


class NotFoundError(VexorError):
    """Raised when an asset, webhook, or resource is not found (HTTP 404)."""


class ConflictError(VexorError):
    """Raised when a state conflict occurs, such as requesting playback for an unready asset (HTTP 409)."""


class RateLimitError(VexorError):
    """Raised when API rate limits are exceeded (HTTP 429)."""

    def __init__(self, message: str, status_code: Optional[int] = None, response_body: Optional[str] = None,
                 retry_after_seconds: Optional[int] = None):
        super().__init__(message, status_code=status_code, response_body=response_body)
        self.retry_after_seconds = retry_after_seconds


class UploadError(VexorError):
    """Raised when resumable video uploading fails."""

    def __init__(self, message: str, upload_url: Optional[str] = None, offset: Optional[int] = None):
        super().__init__(message)
        self.upload_url = upload_url
        self.offset = offset


class SignatureVerificationError(VexorError):
    """Raised when a webhook signature fails cryptographic verification."""
