"""Webhook signature verification and payload handling."""

import hashlib
import hmac
import json
import re
from typing import Union, Dict, Any, Optional

from .errors import SignatureVerificationError, VexorError


class Webhooks:
    """Helper for verifying and handling Vexor webhook events."""

    def __init__(self, secret: Optional[str] = None):
        self.default_secret = secret

    @classmethod
    def verify(
        cls,
        payload: Union[str, bytes],
        signature: str,
        secret: str,
    ) -> bool:
        """
        Verify the HMAC-SHA256 signature of an incoming webhook payload.

        Args:
            payload: Raw request body as bytes or string.
            signature: Value of the 'X-Vexor-Signature' header.
            secret: Webhook endpoint secret.

        Returns:
            True if the signature is valid, False otherwise.
        """
        if not secret or not signature:
            return False

        if isinstance(payload, str):
            payload = payload.encode("utf-8")

        provided_sig = signature.strip()
        if provided_sig.lower().startswith("sha256="):
            provided_sig = provided_sig[7:]
        if not re.fullmatch(r"[0-9a-fA-F]{64}", provided_sig):
            return False

        expected_sig = hmac.new(
            secret.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).hexdigest()

        # Accept the documented raw hex value and the common sha256= prefix.
        return hmac.compare_digest(expected_sig, provided_sig.lower())

    @classmethod
    def construct(
        cls,
        payload: Union[str, bytes],
        signature: str,
        secret: str,
    ) -> Dict[str, Any]:
        """
        Verify signature and return the deserialized event object.

        Raises:
            SignatureVerificationError: If the signature is invalid.
            ValueError: If the payload is not valid JSON.
        """
        if not cls.verify(payload, signature, secret):
            raise SignatureVerificationError("The provided webhook signature is invalid.")

        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")

        event = json.loads(payload)
        if not isinstance(event, dict) or any(not isinstance(event.get(field), str) for field in (
            "event_id", "type", "asset_id", "account_id", "timestamp"
        )):
            raise VexorError("The signed Vexor webhook payload is invalid.")
        return event

    def verify_signature(
        self,
        payload: Union[str, bytes],
        signature: str,
        secret: Optional[str] = None,
    ) -> bool:
        active_secret = secret or self.default_secret
        return self.verify(payload, signature, active_secret)

    def construct_event(
        self,
        payload: Union[str, bytes],
        signature: str,
        secret: Optional[str] = None,
    ) -> Dict[str, Any]:
        active_secret = secret or self.default_secret
        return self.construct(payload, signature, active_secret)
