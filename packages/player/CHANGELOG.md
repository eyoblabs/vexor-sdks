# Changelog

## 0.1.4

- Point repository and issue tracker URLs to the dedicated public repository (`https://github.com/eyoblabs/vexor-sdks`).
- Enrich package README and quickstart documentation.

## 0.1.3

- Refresh the README branding and use the current VEXOR public site URL.

## 0.1.2

- Add YouTube-style video buffer bar displaying preloaded and downloaded HLS stream segments in real-time.
- Active buffer tracking on `progress` and `seeked` events so buffer ranges update continuously when paused or seeking.
- Update played progress track and focus styling to Vexor brand accent color (`--vexor-accent, #ec6d1c`).
- Add repository, bugs, homepage, keywords, sideEffects, and explicit `publishConfig: { access: "public" }` metadata.

## 0.1.1

- Use the latest `onReady` callback for progressive MP4 playback so callback updates are not lost to a stale render closure.
