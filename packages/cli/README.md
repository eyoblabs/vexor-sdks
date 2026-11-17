# Vexor CLI

Use Vexor from a terminal to connect an application, upload videos, follow processing, inspect assets, and issue playback details.

## Install

After the package is published:

```sh
npm install -g @vexor/cli
```

Run once without a global install:

```sh
npx @vexor/cli --help
```

## Connect

Create an API key in the Vexor console, then run:

```sh
vexor auth login
```

The CLI prompts without echoing the key, validates it against Vexor, and saves it under your user configuration directory. On Unix-like systems, the config file is restricted to the current user. The CLI never writes credentials into the application being initialized or prints the full key.

For CI, containers, and temporary sessions, use environment variables instead:

```sh
VEXOR_API_URL=https://api.vexor.et
VEXOR_API_KEY=your_api_key
```

PowerShell:

```powershell
$env:VEXOR_API_URL = 'https://api.vexor.et'
$env:VEXOR_API_KEY = 'your_api_key'
```

For local development, set `VEXOR_API_URL=http://localhost:8080`. The CLI allows unencrypted HTTP only for localhost.

## Open the browser console

```sh
vexor studio
# alias
vexor console
```

This opens the dashboard in your default browser (`http://localhost:3000` by default). If the browser has no active Vexor session, the console redirects to sign-in; use the same API key there. The CLI's saved key and the browser's HttpOnly session remain separate. For a deployed console, set `VEXOR_CONSOLE_URL` to its HTTPS origin or pass `--console-url https://your-console.example`.

## First video

Run `vexor` in an interactive terminal to open the developer studio: see recent processing, available wallet credit, and quick actions for upload, job watching, diagnostics, and the browser console. Run `vexor --help` for the command reference or `vexor home --json` for a machine-readable overview.

```sh
vexor doctor
vexor videos upload ./lesson.mp4 --wait
vexor assets list
vexor playback <asset-id>
```

Run `vexor videos upload` without a path to open the native video picker, or use `--pick` to open it explicitly. You can also drag a file into the terminal or pass its path. The picker supports Windows and macOS natively, plus Zenity/KDialog on Linux; if no picker is available, the CLI asks for a path.

Uploads use Vexor's direct multipart upload API. If the process or network stops, run the same upload command again; the CLI checks the saved session and resumes completed parts. Session metadata is stored in your user configuration directory. Vexor direct uploads must be enabled for the API environment.

`--concurrency` controls parallel part uploads (1–16, default 4). `--wait` follows the asset until it is ready or fails. Use `vexor videos watch <asset-id>` later to follow an existing job.

## Connect an application

Generate a server-side helper:

```sh
vexor init next
# or
vexor init node
```

The helper calls `POST /v1/tokens` and returns the short-lived manifest URL, playback token, and optional thumbnail URL. Call it only after your application's own authorization checks confirm that the viewer may access the asset. Keep `VEXOR_API_KEY` in server-only environment variables and pass only the returned playback details to the player.

## Commands

```text
vexor auth login [--api-url URL]
vexor auth status
vexor auth logout
vexor doctor
vexor studio
vexor init <next|node> [--force]
vexor assets list [--limit N]
vexor assets get <asset-id>
vexor assets delete <asset-id> --force
vexor webhooks list [--limit N] [--cursor ID]
vexor webhooks deliveries [--limit N] [--cursor ID]
vexor webhooks replay <delivery-id> --force
vexor videos upload [file] [--pick] [--concurrency N] [--wait]
vexor videos watch <asset-id> [--timeout seconds]
vexor playback <asset-id> [--viewer-id ID] [--session-id ID]
```

Add `--json` to commands for machine-readable output. Use `--api-url` to override the configured API origin for one invocation.

## Current scope

This first CLI release covers account connection, API diagnostics, assets, direct multipart upload, processing status, and playback token issuance. Framework starters currently target Next.js and Node.js. More integrations can be added after this end-to-end path is stable.

Interactive terminals show the Vexor voxel wordmark in its copper palette. Uploads animate the chunk stream alongside the real byte count, speed, and ETA; transcodes animate the actual source, probe, FFmpeg, and HLS stages with the backend-reported percentage. Piped and `--json` output stays static and machine-readable.

## License

The Vexor CLI is licensed under the MIT License. This license applies to the files in this package and is separate from the proprietary license for the rest of the Vexor repository. See [LICENSE](LICENSE).
