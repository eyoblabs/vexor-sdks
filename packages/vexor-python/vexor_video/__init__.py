"""Official Python SDK for the Vexor Video Platform."""

from .client import Vexor, RawResponse
from .webhooks import Webhooks
from .storage_connections import StorageConnections
from .errors import (
    VexorError,
    AuthenticationError,
    NotFoundError,
    PermissionError,
    ConflictError,
    RateLimitError,
    UploadError,
    SignatureVerificationError,
)

__all__ = [
    "Vexor",
    "RawResponse",
    "Webhooks",
    "StorageConnections",
    "VexorError",
    "AuthenticationError",
    "NotFoundError",
    "PermissionError",
    "ConflictError",
    "RateLimitError",
    "UploadError",
    "SignatureVerificationError",
]

__version__ = "0.1.2"
