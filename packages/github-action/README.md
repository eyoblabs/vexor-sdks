# Vexor Video Pipeline GitHub Action

Official GitHub Action for [Vexor](https://vexor.et) — Upload, transcode, import, and preview high-performance HLS video streams directly in your CI/CD pipelines.

Zero external dependencies (runs natively on Node.js 20+).

---

## Quick Start

### 1. Upload & Publish Local Video on Release
Transcode and publish videos when creating a GitHub release:

```yaml
name: Publish Release Video
on:
  release:
    types: [published]

jobs:
  video:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Process Video with Vexor
        id: vexor
        uses: eyob13-coder/Vexor-@main
        with:
          api_key: ${{ secrets.VEXOR_API_KEY }}
          video_path: "assets/release-demo.mp4"
          wait_for_ready: true

      - name: Use Outputs
        run: |
          echo "Asset ID: ${{ steps.vexor.outputs.asset_id }}"
          echo "Stream URL: ${{ steps.vexor.outputs.playback_url }}"
          echo "Embed Code: ${{ steps.vexor.outputs.embed_iframe }}"
```

---

### 2. PR Video Previews & Review Bot
Automatically transcode demo videos modified in a Pull Request and post an interactive player preview:

```yaml
name: Pull Request Video Preview
on:
  pull_request:
    paths:
      - 'demos/**.mp4'
      - 'assets/**.mov'

permissions:
  pull-requests: write
  contents: read

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Transcode & Comment on PR
        uses: eyob13-coder/Vexor-@main
        with:
          api_key: ${{ secrets.VEXOR_API_KEY }}
          video_path: "demos/feature-walkthrough.mp4"
          comment_on_pr: true
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

---

### 3. Import from Connected Cloud Storage
Trigger video transcoding directly from your connected AWS S3, Google Cloud Storage, Azure Blob, or Oracle Cloud bucket:

```yaml
name: Ingest Cloud Video
on:
  workflow_dispatch:
    inputs:
      object_key:
        description: 'S3/GCS Object Key'
        required: true

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: eyob13-coder/Vexor-@main
        with:
          api_key: ${{ secrets.VEXOR_API_KEY }}
          connection_id: "your-storage-connection-uuid"
          object_key: ${{ github.event.inputs.object_key }}
          wait_for_ready: true
```

---

## Inputs

| Name | Description | Default | Required |
|---|---|---|---|
| `api_key` | Vexor live API key (`vx_live_...`) | — | **Yes** |
| `api_url` | Official Vexor API origin. Custom hosts are rejected to protect the API key. | `https://api.vexor.et` | No |
| `video_path` | Local file path to upload (e.g. `assets/demo.mp4`) | — | Conditional* |
| `connection_id` | UUID of connected storage connection (S3, GCS, Azure, Oracle) | — | Conditional* |
| `object_key` | Object key or URI in connected storage to import | — | Conditional* |
| `filename` | Optional asset display filename | Auto-detected | No |
| `wait_for_ready` | Wait until transcoding completes before finishing step | `true` | No |
| `timeout_minutes` | Maximum wait time for video transcoding | `15` | No |
| `enhance_upscale` | Enable AI video enhancement and upscaling | `false` | No |
| `enhance_tier` | Target upscale resolution (`1080p`, `4k`) | `none` | No |
| `comment_on_pr` | Post interactive preview comment on the Pull Request | `false` | No |
| `github_token` | GitHub token for posting PR comments | `${{ github.token }}` | No |

*\*Either `video_path` or both `connection_id` and `object_key` must be provided.*

---

## Outputs

| Name | Description | Example |
|---|---|---|
| `asset_id` | Unique UUID of the created video asset | `8277ede2-b200-4913-9fe7-4d039d4ee289` |
| `state` | Processing state | `ready`, `transcoding`, `failed` |
| `playback_url` | HLS adaptive bitrate master playlist URL | `https://api.vexor.et/v1/assets/{id}/hls/master.m3u8` |
| `embed_url` | Standalone responsive player page | `https://vexor.et/embed/{id}` |
| `embed_iframe` | Ready-to-use HTML `<iframe />` tag | `<iframe src="..." width="100%" height="450"></iframe>` |
| `thumbnail_url` | Poster frame image URL | `https://api.vexor.et/v1/assets/{id}/thumbnail.jpg` |
| `duration_seconds` | Video duration in seconds | `84` |

---

## Security

* **Secret Masking**: The Vexor API key and GitHub comment token are registered with GitHub Actions secret masking.
* **Authenticated API Safety**: The API key is sent only to the fixed official `https://api.vexor.et` origin. Custom hosts and non-standard ports are rejected, and redirects are disabled. Loopback URLs are accepted only in the test environment.
* **Input Validation**: Boolean and enhancement-tier inputs are validated explicitly, and direct-upload and cloud-import modes cannot be mixed.
* **Upload Integrity**: The action rejects missing, duplicate, and out-of-range signed part numbers before transferring file data.
* **Signed Upload Safety**: Storage upload URLs must use HTTPS, redirects are rejected, and credentials or cookie headers are never forwarded to storage.
* **Safe Outputs**: Step outputs use unique multiline delimiters to prevent newline-based output injection.
* **Least Privilege**: Grant `pull-requests: write` only when `comment_on_pr: true` is enabled; otherwise, read access is sufficient.
* **Zero Runtime Dependencies**: The action uses native Node.js APIs and does not install third-party packages at runtime.

## License
MIT
