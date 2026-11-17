"""Account-scoped customer storage connections for import and output."""

from typing import Any, Dict, List, Optional
import urllib.parse

from .errors import VexorError


class StorageConnections:
    """Connect S3-compatible buckets for source imports or generated media."""

    def __init__(self, client):
        self._client = client

    def list(self) -> List[Dict[str, Any]]:
        """List configured connections. Credential secrets are never returned."""
        response = self._client.request("GET", "/v1/storage-connections")
        if not isinstance(response, dict) or not isinstance(response.get("data"), list):
            raise VexorError("Vexor returned an invalid storage connection list")
        return response["data"]

    def aws_identity(self) -> Dict[str, str]:
        """Return VEXOR's AWS caller ARN for configuring a customer role trust policy."""
        response = self._client.request("GET", "/v1/storage-connections/aws-identity")
        data = response.get("data") if isinstance(response, dict) else None
        if not isinstance(data, dict) or not isinstance(data.get("principal_arn"), str):
            raise VexorError("Vexor returned an invalid AWS identity response")
        return {"principal_arn": data["principal_arn"]}

    def create(
        self,
        *,
        name: str,
        bucket: str,
        region: str = "auto",
        prefix: str = "",
        endpoint: Optional[str] = None,
        access_key_id: Optional[str] = None,
        secret_access_key: Optional[str] = None,
        auth_mode: str = "access_key",
        role_arn: Optional[str] = None,
        external_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a scoped connection with static keys or AWS role delegation."""
        auth_mode = auth_mode.strip().lower() if isinstance(auth_mode, str) else ""
        required = {"name": name, "bucket": bucket}
        if any(not isinstance(value, str) or not value.strip() for value in required.values()):
            raise ValueError("name and bucket are required non-empty strings")
        if not isinstance(region, str) or not region.strip() or not isinstance(prefix, str):
            raise ValueError("region must be a non-empty string and prefix must be a string")
        payload = {"name": name.strip(), "bucket": bucket.strip(), "region": region.strip(), "prefix": prefix.strip()}
        if auth_mode == "aws_role":
            if not isinstance(role_arn, str) or not role_arn.strip() or not isinstance(external_id, str) or not external_id.strip():
                raise ValueError("role_arn and external_id are required for AWS role authentication")
            if not 16 <= len(external_id.strip()) <= 1224:
                raise ValueError("external_id must be between 16 and 1224 characters")
            if access_key_id or secret_access_key:
                raise ValueError("static access keys cannot be combined with AWS role authentication")
            if endpoint is not None and (
                not isinstance(endpoint, str) or endpoint.strip()
            ):
                raise ValueError("endpoint is not accepted for AWS role authentication")
            payload.update({"auth_mode": "aws_role", "role_arn": role_arn.strip(), "external_id": external_id.strip()})
        elif auth_mode == "access_key":
            static_values = {"endpoint": endpoint, "access_key_id": access_key_id, "secret_access_key": secret_access_key}
            if any(not isinstance(value, str) or not value.strip() for value in static_values.values()):
                raise ValueError("endpoint, access_key_id, and secret_access_key are required for access_key authentication")
            payload.update({
                "auth_mode": "access_key",
                "endpoint": endpoint.strip(),
                "access_key_id": access_key_id.strip(),
                "secret_access_key": secret_access_key.strip(),
            })
        else:
            raise ValueError("auth_mode must be 'access_key' or 'aws_role'")
        response = self._client.request(
            "POST",
            "/v1/storage-connections",
            json_data=payload,
        )
        if not isinstance(response, dict) or not isinstance(response.get("data"), dict):
            raise VexorError("Vexor returned an invalid storage connection response")
        return response["data"]

    def verify(self, connection_id: str) -> Dict[str, Any]:
        """Check that VEXOR can still reach the configured bucket."""
        if not isinstance(connection_id, str) or not connection_id.strip():
            raise ValueError("connection_id is required")
        connection_id = connection_id.strip()
        response = self._client.request("POST", f"/v1/storage-connections/{urllib.parse.quote(connection_id, safe='')}/verify")
        if not isinstance(response, dict) or not isinstance(response.get("data"), dict):
            raise VexorError("Vexor returned an invalid storage verification response")
        if not isinstance(response["data"].get("verified"), bool):
            raise VexorError("Vexor returned an invalid storage verification result")
        return response["data"]

    def revoke(self, connection_id: str) -> None:
        """Revoke credentials when no queued or retryable source jobs depend on them."""
        if not isinstance(connection_id, str) or not connection_id.strip():
            raise ValueError("connection_id is required")
        connection_id = connection_id.strip()
        self._client.request("DELETE", f"/v1/storage-connections/{urllib.parse.quote(connection_id, safe='')}")
