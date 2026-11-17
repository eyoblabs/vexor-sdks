<p align="center">
  <a href="https://vexor-video.vercel.app/"><img src="https://vexor-video.vercel.app/brands/vexor-logo-256.png" alt="VEXOR" width="104"></a>
</p>

<h1 align="center">VEXOR Python SDK</h1>

<p align="center">Official zero-dependency Python client for the VEXOR video platform.</p>

<p align="center">
  <a href="https://pypi.org/project/vexor-video-sdk/"><img src="https://img.shields.io/pypi/v/vexor-video-sdk.svg?color=ea580c" alt="PyPI version"></a>
  <a href="https://github.com/eyoblabs/vexor-sdks/tree/main/packages/vexor-python"><img src="https://img.shields.io/badge/GitHub-eyoblabs%2Fvexor--sdks-black?logo=github" alt="GitHub Repository"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="https://pypi.org/project/vexor-video-sdk/">PyPI Package</a> · 
  <a href="https://github.com/eyoblabs/vexor-sdks">GitHub Monorepo</a> · 
  <a href="https://vexor-video.vercel.app/">VEXOR Console</a> · 
  <a href="https://vexor-video.vercel.app/developers">Developer Documentation</a>
</p>

The official Python client for the [VEXOR](https://vexor-video.vercel.app/) video platform.

- **Zero dependencies**: Pure Python standard library (`urllib`, `hmac`, `hashlib`, `json`). No `requests`, `urllib3`, or `aiohttp` dependency conflicts.
- **Resumable uploads**: Built-in chunked [tus](https://tus.io) client with progress callbacks and automatic retry.
- **Playback security**: Requests short-lived Ed25519 playback tokens for AES-128 encrypted HLS streaming.
- **Cryptographic webhooks**: Automatic HMAC-SHA256 signature verification.
- **Type-hinted**: Type hints on the public API; Python 3.9+.

---

## Installation

```bash
pip install vexor-video-sdk
```

For local development in a repository checkout, install the package in editable mode from this directory:
```bash
pip install -e .
```

The SDK reads `VEXOR_API_KEY` and `VEXOR_BASE_URL` from the environment. Set
`VEXOR_BASE_URL` to your deployed VEXOR API origin; the public site at
`https://vexor-video.vercel.app/` is separate from the API. The API URL must use
HTTPS except for `localhost`, `127.0.0.1`, or `::1` during local development.

---

## Quickstart

```python
from vexor_video import Vexor

# Initialize client (defaults to VEXOR_API_KEY and VEXOR_BASE_URL env vars)
client = Vexor(api_key="vex_live_your_key_here")

# 1. Upload a video (resumable tus upload with progress tracking)
def on_progress(uploaded, total):
    percent = (uploaded / total) * 100
    print(f"Uploading: {percent:.1f}% ({uploaded}/{total} bytes)")

asset = client.assets.upload(
    "lecture.mp4",
    title="Introduction to Calculus",
    on_progress=on_progress,
)
print(f"Asset created: {asset['id']}")

# 2. Generate a secure playback session (when asset state is 'ready')
playback = client.tokens.create(
    asset_id=asset["id"],
    viewer_id="user_12345",
)
print(f"Playable HLS Manifest: {playback['manifest_url']}")
print(f"Thumbnail: {playback.get('thumbnail_url')}")
```

## Importing from your storage

When your source videos already live in an S3-compatible bucket, connect it once and import objects by key instead of re-uploading their bytes through your application. The connection endpoint must be public HTTPS. VEXOR encrypts the submitted credentials at rest and only returns a masked key hint.

```python
import os

connection = client.storage_connections.create(
    name="Course videos",
    endpoint="https://s3.example.net",
    region="us-east-1",
    bucket="course-media",
    prefix="published",
    access_key_id=os.environ["COURSE_STORAGE_ACCESS_KEY"],
    secret_access_key=os.environ["COURSE_STORAGE_SECRET_KEY"],
)

asset = client.assets.import_from_storage(
    connection_id=connection["id"],
    object_key="lesson-01.mp4",  # relative to the configured prefix
)
print(asset["id"], asset["state"])
```

For AWS S3, the SDK also supports VEXOR's role-delegation flow. Use an IAM
role scoped to the intended bucket. First retrieve VEXOR's deployment
principal with `client.storage_connections.aws_identity()` and use it in the
role trust policy. Create and retain a unique external ID of at least 16
characters for the connection; do not include static keys in this mode:

```python
connection = client.storage_connections.create(
    name="Course videos",
    bucket="course-media",
    region="us-east-1",
    auth_mode="aws_role",
    role_arn="arn:aws:iam::123456789012:role/VexorSourceReader",
    external_id=os.environ["VEXOR_AWS_EXTERNAL_ID"],
)
```

The identity endpoint requires VEXOR to be running with its AWS deployment
identity and STS `GetCallerIdentity` access. A local VEXOR deployment without
AWS credentials cannot create or verify AWS role connections.

The imported original stays in your bucket. VEXOR reads it asynchronously, stores processed HLS in its managed media origin, and handles signed playback delivery. Customer-managed output is a later option that deployments can explicitly enable. Processing status and webhooks use the normal asset lifecycle. See the [storage and upload guide](https://vexor-video.vercel.app/docs) for supported flows and permissions.

---

## Asset Management

### Uploading Videos
The `upload` method supports local file paths, open binary file objects, and in-memory bytes:

```python
# From a file path:
asset = client.assets.upload("/path/to/video.mov")

# From an open file handle (e.g. Django UploadedFile, FastAPI UploadFile):
asset = client.assets.upload(file_obj, filename="upload.mp4")

# From bytes:
asset = client.assets.upload(raw_bytes, filename="stream.mp4")
```

### Retrieving & Listing Assets
```python
# Get single asset metadata and transcoding status
asset = client.assets.get("ea56fdde-ad35-44f6-ad9a-8cd01c4f10d1")
print(asset["state"])  # 'uploading', 'uploaded', 'transcoding', 'ready', or 'failed'

# List assets with cursor pagination
page = client.assets.list_page(limit=25)
for asset in page["data"]:
    print(asset["id"], asset["filename"], asset["state"])

if page["next_cursor"]:
    next_page = client.assets.list_page(limit=25, cursor=page["next_cursor"])
```

Uploads retry transient failures. `UploadError.upload_url` contains the Tus
session URL when an upload fails. To resume after a process restart, save the
URL as soon as it is created with `on_upload_created`, then pass it back with
the same complete file. Store the URL securely. Resuming checks the session
size and requires a seekable file when starting from a non-zero offset.

### Deleting Assets
```python
# Queues asset deletion; VEXOR removes its managed media and associated records.
client.assets.delete("ea56fdde-ad35-44f6-ad9a-8cd01c4f10d1")
```

---

## Playback & Tokens

Vexor media is encrypted with AES-128 CBC. Video segments can only be decrypted with short-lived tokens:

```python
session = client.tokens.create(
    asset_id="ea56fdde-ad35-44f6-ad9a-8cd01c4f10d1",
    viewer_id="student_987",        # Used for dynamic session watermarking
    session_id="device_sess_xyz",   # Optional: limits concurrent playback
)

manifest_url = session["manifest_url"]
# Pass manifest_url directly to Video.js, HLS.js, ExoPlayer, or AVPlayer
```

If the asset is still transcoding, `client.tokens.create()` raises `ConflictError` (HTTP 409).

---

## Webhook Verification

Vexor signs all webhook requests using HMAC-SHA256 via the `X-Vexor-Signature` header.

### Standalone Webhook Helper
```python
from vexor_video import Webhooks, SignatureVerificationError

raw_body = request.body  # bytes
signature = request.headers.get("X-Vexor-Signature")

try:
    event = Webhooks.construct(raw_body, signature, secret="whsec_...")
    if event["type"] == "video.asset.ready":
        asset_id = event["asset_id"]
        print(f"Asset {asset_id} is ready for playback!")
except SignatureVerificationError:
    return "Invalid signature", 400
```

---

## Framework Integration Examples

### Django

```python
# views.py
import json
from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from vexor_video import Vexor, Webhooks, SignatureVerificationError, ConflictError

client = Vexor()  # reads VEXOR_API_KEY and VEXOR_WEBHOOK_SECRET from env

@csrf_exempt
def vexor_webhook_view(request):
    if request.method != "POST":
        return HttpResponse(status=405)

    signature = request.headers.get("X-Vexor-Signature", "")
    try:
        event = Webhooks.construct(request.body, signature, client.webhook_secret)
    except SignatureVerificationError:
        return HttpResponse("Invalid signature", status=400)

    event_type = event.get("type")
    if event_type == "video.asset.ready":
        asset_id = event["asset_id"]
        # Update database: Lesson.objects.filter(vexor_asset_id=asset_id).update(status="ready")

    return HttpResponse(status=200)

def get_lesson_stream(request, lesson_id):
    lesson = Lesson.objects.get(id=lesson_id)
    try:
        playback = client.tokens.create(
            asset_id=lesson.vexor_asset_id,
            viewer_id=str(request.user.id),
        )
        return JsonResponse({"manifest_url": playback["manifest_url"]})
    except ConflictError:
        return JsonResponse({"error": "Video is still processing"}, status=409)
```

### FastAPI

```python
from fastapi import FastAPI, Header, HTTPException, Request
from vexor_video import Vexor, Webhooks, SignatureVerificationError, ConflictError

app = FastAPI()
vexor = Vexor()

@app.post("/webhooks/vexor")
async def handle_vexor_webhook(
    request: Request,
    x_vexor_signature: str = Header(None),
):
    body = await request.body()
    try:
        event = Webhooks.construct(body, x_vexor_signature, vexor.webhook_secret)
    except SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    if event["type"] == "video.asset.ready":
        print(f"Ready: {event['asset_id']}")

    return {"status": "ok"}
```

### Flask

```python
from flask import Flask, request, jsonify
from vexor_video import Vexor, Webhooks, SignatureVerificationError

app = Flask(__name__)
vexor = Vexor()

@app.route("/webhooks/vexor", methods=["POST"])
def webhook():
    signature = request.headers.get("X-Vexor-Signature", "")
    try:
        event = Webhooks.construct(request.get_data(), signature, vexor.webhook_secret)
    except SignatureVerificationError:
        return "Invalid signature", 400

    return jsonify({"received": True})
```

---

## Error Handling

All SDK errors inherit from `vexor_video.VexorError`:

```python
from vexor_video import (
    Vexor,
    VexorError,
    AuthenticationError,
    PermissionError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    UploadError,
)

try:
    playback = client.tokens.create(asset_id="some-id")
except ConflictError as e:
    # Asset is still encoding / not yet ready
    print(f"Video is still processing: {e}")
except NotFoundError:
    # Asset does not exist
    print("Video not found")
except AuthenticationError:
    # Invalid or missing API key
    print("Check your Vexor API key")
except PermissionError:
    # The key is valid but lacks access to this account or resource
    print("Check the API key permissions")
except RateLimitError:
    # Rate limit hit
    print("Back off and retry")
    # error.retry_after_seconds is populated when the API provides Retry-After.
except VexorError as e:
    print(f"API Error ({e.status_code}): {e.message}")
```

---

## Support Vexor

If Vexor helps your product, you can support its continued development on [Support Vexor](https://buymeacoffee.com/eyob_dev).

## License

The Python SDK is licensed under the MIT License. This license applies to this package and is separate from the proprietary license for the rest of the Vexor repository. See [LICENSE](LICENSE).

MIT © [VEXOR](https://vexor-video.vercel.app/)
