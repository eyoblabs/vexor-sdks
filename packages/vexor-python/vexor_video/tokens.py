"""Token and playback session management."""

import uuid
from typing import Dict, Any, Optional

from .errors import VexorError

class Tokens:
    """Manages short-lived playback tokens and manifests."""

    def __init__(self, client):
        self._client = client

    def create(
        self,
        asset_id: str,
        viewer_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Request a short-lived signed playback token and authenticated master manifest URL.

        Args:
            asset_id: The UUID of the target video asset.
            viewer_id: Optional identifier of the authenticated viewer (for watermarking / auditing).
            session_id: Optional session identifier for concurrent stream limiting.

        Returns:
            Dict containing 'token', 'manifest_url', and optionally 'thumbnail_url'.

        Raises:
            ConflictError: If the asset is not yet ready for playback (e.g. still transcoding).
            NotFoundError: If the asset does not exist.
            AuthenticationError: If the API key is missing or invalid.
        """
        if not isinstance(asset_id, str) or not asset_id.strip():
            raise ValueError("asset_id is required")
        if viewer_id is not None and not isinstance(viewer_id, str):
            raise ValueError("viewer_id must be a string")
        if session_id is not None and not isinstance(session_id, str):
            raise ValueError("session_id must be a string")

        payload = {
            "asset_id": asset_id.strip(),
            "viewer_id": viewer_id or "anonymous",
            "session_id": session_id or f"sess_{uuid.uuid4().hex}",
        }

        response = self._client.request("POST", "/v1/tokens", json_data=payload)
        if not isinstance(response, dict) or not isinstance(response.get("token"), str) or not isinstance(response.get("manifest_url"), str):
            raise VexorError("Vexor returned an invalid playback session response")
        return response
