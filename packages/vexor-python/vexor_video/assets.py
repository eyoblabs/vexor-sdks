"""Asset management and resumable video uploads."""

import base64
import io
import mimetypes
import os
import time
import urllib.parse
from typing import Union, Optional, Dict, Any, Callable, BinaryIO, List

from .errors import UploadError, VexorError

MAX_CHUNK_SIZE = 64 * 1024 * 1024
MAX_UPLOAD_RETRIES = 5


class Assets:
    """Manages video assets and uploads."""

    def __init__(self, client):
        self._client = client

    def get(self, asset_id: str) -> Dict[str, Any]:
        """Fetch asset metadata, state, and transcoding progress."""
        if not isinstance(asset_id, str) or not asset_id.strip():
            raise ValueError("asset_id is required")
        asset_id = asset_id.strip()
        return self._client.request("GET", f"/v1/assets/{urllib.parse.quote(asset_id, safe='')}")

    def import_from_storage(
        self,
        connection_id: str,
        object_key: str,
        filename: Optional[str] = None,
        output_connection_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Queue an object from a connected bucket for VEXOR processing.

        The customer's source object stays in its bucket. VEXOR stores and
        delivers generated HLS through its managed media origin in the first
        release. ``output_connection_id`` is available only when customer
        output storage is explicitly enabled by the deployment.
        """
        if not isinstance(connection_id, str) or not connection_id.strip() or not isinstance(object_key, str) or not object_key.strip():
            raise ValueError("connection_id and object_key are required non-empty strings")
        connection_id = connection_id.strip()
        object_key = object_key.strip()
        payload = {"connection_id": connection_id, "object_key": object_key}
        if filename is not None:
            if not isinstance(filename, str) or not filename.strip():
                raise ValueError("filename must be a non-empty string when provided")
            payload["filename"] = filename.strip()
        if output_connection_id is not None:
            if not isinstance(output_connection_id, str) or not output_connection_id.strip():
                raise ValueError("output_connection_id must be a non-empty string when provided")
            payload["output_connection_id"] = output_connection_id.strip()
        response = self._client.request("POST", "/v1/assets/imports", json_data=payload)
        if not isinstance(response, dict) or not isinstance(response.get("data"), dict):
            raise VexorError("Vexor returned an invalid import response")
        return response["data"]

    def list(
        self,
        limit: int = 50,
        offset: int = 0,
        cursor: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return one cursor-paginated page of assets.

        ``offset`` is retained for compatibility with the first SDK draft. The
        Vexor API uses cursor pagination, so non-zero offsets are unsupported.
        Use :meth:`list_page` when the next cursor is needed.
        """
        if offset != 0:
            raise ValueError("offset pagination is not supported; use cursor=list_page(...)[\"next_cursor\"]")
        return self.list_page(limit=limit, cursor=cursor)["data"]

    def list_page(self, limit: int = 50, cursor: Optional[str] = None) -> Dict[str, Any]:
        """Return an asset page with its ``data`` and ``next_cursor`` fields."""
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 100:
            raise ValueError("limit must be an integer between 1 and 100")
        response = self._client.request(
            "GET",
            "/v1/assets/page",
            params={"limit": limit, "cursor": cursor},
        )
        if not isinstance(response, dict) or not isinstance(response.get("data"), list):
            raise VexorError("Vexor returned an invalid asset page response")
        return {
            "data": response["data"],
            "next_cursor": response.get("next_cursor", ""),
        }

    def delete(self, asset_id: str) -> bool:
        """Queue deletion of an asset and purge its files from edge storage."""
        if not isinstance(asset_id, str) or not asset_id.strip():
            raise ValueError("asset_id is required")
        asset_id = asset_id.strip()
        self._client.request("DELETE", f"/v1/assets/{urllib.parse.quote(asset_id, safe='')}")
        return True

    def upload(
        self,
        file_or_path: Union[str, os.PathLike, BinaryIO, bytes],
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
        title: Optional[str] = None,
        chunk_size: int = 16 * 1024 * 1024,
        on_progress: Optional[Callable[[int, int], None]] = None,
        upload_url: Optional[str] = None,
        max_retries: int = 3,
        on_upload_created: Optional[Callable[[str], None]] = None,
    ) -> Dict[str, Any]:
        """
        Upload a video file to Vexor using the resumable tus protocol.

        Args:
            file_or_path: File path (str), open binary file object, or bytes.
            filename: Original file name. Auto-detected if a path is provided.
            content_type: MIME type (e.g. 'video/mp4'). Auto-detected if omitted.
            title: Optional title for the video asset.
            chunk_size: Chunk size in bytes (default 16 MB).
            on_progress: Optional callback invoked with (bytes_uploaded, total_bytes).
            upload_url: URL from a previous :class:`UploadError` to resume.
            max_retries: Retries for transient network and server failures (0-5).
            on_upload_created: Callback to persist the Tus URL for process restarts.

        Returns:
            Dict containing asset metadata, including 'id', 'state', and 'filename'.
        """
        if not isinstance(chunk_size, int) or isinstance(chunk_size, bool) or not 1 <= chunk_size <= MAX_CHUNK_SIZE:
            raise ValueError(f"chunk_size must be an integer between 1 and {MAX_CHUNK_SIZE} bytes")
        if not isinstance(max_retries, int) or isinstance(max_retries, bool) or not 0 <= max_retries <= MAX_UPLOAD_RETRIES:
            raise ValueError(f"max_retries must be an integer between 0 and {MAX_UPLOAD_RETRIES}")

        owns_file = isinstance(file_or_path, (str, os.PathLike, bytes))
        file_obj, total_size, resolved_filename = self._resolve_file_source(file_or_path, filename)
        if total_size <= 0:
            if owns_file:
                file_obj.close()
            raise ValueError("video file must not be empty")
        try:
            start_position = file_obj.tell() if hasattr(file_obj, "tell") else 0
        except (OSError, ValueError):
            start_position = 0
        resolved_content_type = content_type or mimetypes.guess_type(resolved_filename)[0] or "video/mp4"
        asset_title = title or resolved_filename

        metadata_parts = []
        if resolved_filename:
            metadata_parts.append(f"filename {base64.b64encode(resolved_filename.encode()).decode()}")
        if resolved_content_type:
            metadata_parts.append(f"filetype {base64.b64encode(resolved_content_type.encode()).decode()}")
        if asset_title:
            metadata_parts.append(f"title {base64.b64encode(asset_title.encode()).decode()}")
        upload_metadata = ",".join(metadata_parts)

        try:
            if upload_url:
                upload_url = urllib.parse.urljoin(self._client.base_url + "/", upload_url)
                offset, declared_size = self._read_upload_offset(upload_url)
                if declared_size != total_size:
                    raise UploadError(
                        f"The saved upload expects {declared_size} bytes, but this file has {total_size} bytes.",
                        upload_url=upload_url,
                        offset=offset,
                    )
                self._seek_for_upload(file_obj, start_position + offset, upload_url, offset)
            else:
                create_headers = {
                    "Tus-Resumable": "1.0.0",
                    "Upload-Length": str(total_size),
                    "Upload-Metadata": upload_metadata,
                }
                response = self._client.request_raw("POST", "/uploads", headers=create_headers)
                location = response.headers.get("Location")
                if not location:
                    raise UploadError("Vexor did not return an upload URL.")
                upload_url = urllib.parse.urljoin(self._client.base_url + "/", location)
                offset = 0

            if on_upload_created:
                try:
                    on_upload_created(upload_url)
                except Exception as error:
                    raise UploadError(
                        f"Could not persist the upload session URL: {error}",
                        upload_url=upload_url,
                        offset=offset,
                    ) from error

            if on_progress:
                on_progress(offset, total_size)

            while offset < total_size:
                chunk_start = offset
                chunk = file_obj.read(min(chunk_size, total_size - offset))
                if not chunk:
                    raise UploadError(
                        "The file ended before all declared bytes were read.",
                        upload_url=upload_url,
                        offset=offset,
                    )
                if isinstance(chunk, str):
                    raise UploadError(
                        "Video files must be opened in binary mode.",
                        upload_url=upload_url,
                        offset=offset,
                    )
                if not isinstance(chunk, bytes):
                    chunk = bytes(chunk)

                for attempt in range(max_retries + 1):
                    patch_headers = {
                        "Tus-Resumable": "1.0.0",
                        "Upload-Offset": str(offset),
                        "Content-Type": "application/offset+octet-stream",
                    }
                    try:
                        patch_response = self._client.request_raw(
                            "PATCH", upload_url, headers=patch_headers, body=chunk
                        )
                    except VexorError as error:
                        retryable = error.status_code is None or error.status_code in (408, 409, 425, 429) or error.status_code >= 500
                        if not retryable or attempt >= max_retries:
                            raise UploadError(
                                f"Upload stopped at byte {offset}: {error}",
                                upload_url=upload_url,
                                offset=offset,
                            ) from error
                        time.sleep(min(0.5 * (2 ** attempt), 4.0))
                        try:
                            server_offset, declared_size = self._read_upload_offset(upload_url)
                        except VexorError as head_error:
                            raise UploadError(
                                f"Could not resume the upload after a connection error: {head_error}",
                                upload_url=upload_url,
                                offset=offset,
                            ) from head_error
                        if declared_size != total_size or server_offset < chunk_start or server_offset > chunk_start + len(chunk):
                            raise UploadError(
                                "The server reported an unexpected upload offset; resume with the same file and upload URL.",
                                upload_url=upload_url,
                                offset=server_offset,
                            ) from error
                        if server_offset == chunk_start:
                            offset = server_offset
                            continue
                        if server_offset < chunk_start + len(chunk) and not self._is_seekable(file_obj):
                            raise UploadError(
                                "The server accepted part of a chunk; reopen a seekable file to resume safely.",
                                upload_url=upload_url,
                                offset=server_offset,
                            ) from error
                        offset = server_offset
                        if server_offset < chunk_start + len(chunk):
                            self._seek_for_upload(file_obj, start_position + offset, upload_url, offset)
                        if on_progress:
                            on_progress(offset, total_size)
                        break

                    raw_offset = patch_response.headers.get("Upload-Offset")
                    try:
                        new_offset = int(raw_offset)
                    except (TypeError, ValueError) as error:
                        raise UploadError(
                            "Vexor returned an invalid upload offset.",
                            upload_url=upload_url,
                            offset=offset,
                        ) from error
                    if new_offset != chunk_start + len(chunk):
                        raise UploadError(
                            "Vexor returned an unexpected upload offset.",
                            upload_url=upload_url,
                            offset=new_offset,
                        )
                    offset = new_offset
                    if on_progress:
                        on_progress(offset, total_size)
                    break
                else:
                    raise UploadError("Upload retries were exhausted.", upload_url=upload_url, offset=offset)
        finally:
            if owns_file and hasattr(file_obj, "close"):
                file_obj.close()

        # Asset completion is recorded asynchronously by the tus completion hook.
        tus_id = upload_url.rstrip("/").split("/")[-1]
        asset_path = f"/v1/assets/by-upload/{urllib.parse.quote(tus_id, safe='')}"
        for attempt in range(5):
            try:
                asset_data = self._client.request("GET", asset_path)
                if isinstance(asset_data, dict) and asset_data.get("id"):
                    return asset_data
                raise UploadError("Vexor returned an invalid asset response after upload.", upload_url, total_size)
            except VexorError as error:
                if error.status_code != 404 or attempt == 4:
                    raise UploadError(
                        f"Upload completed, but Vexor did not confirm the asset: {error}",
                        upload_url=upload_url,
                        offset=total_size,
                    ) from error
                time.sleep(0.25 * (attempt + 1))
        raise UploadError("Upload completed, but Vexor has not registered the asset yet.", upload_url, total_size)

    def _read_upload_offset(self, upload_url: str):
        response = self._client.request_raw(
            "HEAD",
            upload_url,
            headers={"Tus-Resumable": "1.0.0"},
        )
        try:
            offset = int(response.headers.get("Upload-Offset"))
            declared_size = int(response.headers.get("Upload-Length"))
        except (TypeError, ValueError) as error:
            raise UploadError("Vexor returned invalid Tus upload status headers.", upload_url) from error
        if offset < 0 or declared_size < 0 or offset > declared_size:
            raise UploadError("Vexor returned an impossible Tus upload offset.", upload_url, offset)
        return offset, declared_size

    @staticmethod
    def _is_seekable(file_obj) -> bool:
        try:
            return bool(file_obj.seekable()) if hasattr(file_obj, "seekable") else hasattr(file_obj, "seek")
        except (OSError, ValueError):
            return False

    @staticmethod
    def _seek_for_upload(file_obj, position: int, upload_url: str, offset: int) -> None:
        if not hasattr(file_obj, "seek"):
            if position == 0:
                return
            raise UploadError("Resuming requires a seekable file object.", upload_url, offset)
        try:
            file_obj.seek(position)
        except (OSError, ValueError) as error:
            raise UploadError("Resuming requires a seekable file object.", upload_url, offset) from error

    def _resolve_file_source(self, file_or_path, filename=None):
        if isinstance(file_or_path, (str, os.PathLike)):
            path = str(file_or_path)
            total_size = os.path.getsize(path)
            resolved_filename = filename or os.path.basename(path)
            file_obj = open(path, "rb")
            return file_obj, total_size, resolved_filename

        if isinstance(file_or_path, bytes):
            total_size = len(file_or_path)
            resolved_filename = filename or "video.mp4"
            file_obj = io.BytesIO(file_or_path)
            return file_obj, total_size, resolved_filename

        if hasattr(file_or_path, "read"):
            try:
                current = file_or_path.tell() if hasattr(file_or_path, "tell") else 0
            except (OSError, ValueError):
                current = 0
            total_size = None
            if hasattr(file_or_path, "seek") and hasattr(file_or_path, "tell"):
                try:
                    file_or_path.seek(0, os.SEEK_END)
                    end = file_or_path.tell()
                    file_or_path.seek(current)
                    total_size = end - current
                except (OSError, ValueError):
                    try:
                        file_or_path.seek(current)
                    except (OSError, ValueError):
                        pass
            if total_size is None and hasattr(file_or_path, "size"):
                try:
                    total_size = int(file_or_path.size) - current
                except (TypeError, ValueError):
                    total_size = None
            if total_size is None:
                raise ValueError("file-like uploads need a size or a seekable file object")
            if not isinstance(total_size, int) or total_size < 0:
                raise ValueError("file-like object reported an invalid size")

            resolved_filename = filename or getattr(file_or_path, "name", "video.mp4")
            if isinstance(resolved_filename, str):
                resolved_filename = os.path.basename(resolved_filename)
            return file_or_path, total_size, resolved_filename

        raise ValueError("file_or_path must be a file path, binary file-like object, or bytes.")
