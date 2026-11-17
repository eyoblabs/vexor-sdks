=== Vexor Video Platform ===
Contributors: eyobog
Donate link: https://buymeacoffee.com/eyob_dev
Tags: video, hls, streaming, player, embed
Requires at least: 5.8
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.3.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Embed secure, adaptive HLS video streaming in WordPress with viewer-specific playback tokens and watermarks powered by Vexor.

== Description ==

Vexor Video Platform allows WordPress site owners, creators, and online course educators to embed secure, fast, adaptive-bitrate HLS video streams into posts, pages, and LMS lessons.

This plugin integrates your WordPress site with VEXOR (https://vexor-video.vercel.app/), a video infrastructure platform that transcodes raw uploads into single-file byte-range HLS streams with token-authenticated playback.

= Key Features =

* **Token-Authorized HLS Playback**: Requests viewer-specific, short-lived playback tokens through WordPress AJAX so static page-caches never leak tokens.
* **Auto-Refreshing Playback**: Seamlessly refreshes playback tokens in the background for long viewing sessions without stream interruptions.
* **Dynamic Watermarking**: Add dynamic visible viewer identifiers (e.g., username or email) to discourage screen recording in courses.
* **Context Protection**: Optional context-menu and drag deterrents to prevent easy media inspection.
* **Asset Library in wp-admin**: Browse your Vexor assets, view thumbnails, and copy ready-to-use shortcodes directly from your WordPress dashboard.
* **Secure Webhook Integration**: Verified HMAC-SHA256 webhooks for automated video readiness notifications and workflow triggers.
* **LMS Access Control**: Easily authorize video playback using the `vexor_can_view_asset` filter for LearnDash, LifterLMS, Tutor LMS, MemberPress, or custom membership plugins.

= Third-Party Service =

This plugin connects to the external Vexor Video Platform API service to manage video assets, generate authenticated playback tokens, and stream adaptive HLS video files.

* Service: Vexor Video Platform
* Website: https://vexor-video.vercel.app/
* Terms of Service: https://vexor-video.vercel.app/terms
* Privacy Policy: https://vexor-video.vercel.app/privacy

== Source Code & Build Instructions ==

In accordance with WordPress.org Plugin Directory Guidelines #1 and #4, all source code used to generate the bundled JavaScript player is public, open-source, and human-readable.

* **Public Repository**: https://github.com/eyob13-coder/Vexor-/tree/main/packages/player
* **Bundled Source Files**: The uncompiled source code is included inside `src/` (`player.ts`, `types.ts`, `native-token-refresh.ts`, `package.json`, `tsup.config.ts`) and the unminified bundle is available at `assets/js/vexor-player.js`.
* **Build Tools**: Node.js 20+, npm, and tsup / esbuild.

To rebuild the player bundle from source:
1. Clone the repository: `git clone https://github.com/eyob13-coder/Vexor-.git`
2. Change into the player package: `cd Vexor-/packages/player`
3. Install dependencies: `npm install`
4. Build the browser bundle: `npm run build`
The compiled standalone IIFE bundle is output to `dist/vexor-player.global.js`.

= Third-Party Libraries =

* **hls.js**: JavaScript HLS media library
  * Version: 1.7.4
  * License: Apache-2.0
  * Repository: https://github.com/video-dev/hls.js
  * Notice: Included inside `assets/licenses/hls.js-MIT.txt` and `assets/licenses/THIRD-PARTY-NOTICES.txt`

== Installation ==

1. Upload the `vexor-video.zip` plugin archive through the WordPress admin (**Plugins -> Add New -> Upload Plugin**) or extract the folder to `/wp-content/plugins/`.
2. Activate the plugin through the 'Plugins' menu in WordPress.
3. Navigate to **Vexor Video -> Settings** in the admin sidebar.
4. Enter your Vexor API Key (and optionally your Webhook Secret).
5. Click **Test Connection** to verify that your WordPress server can communicate with Vexor.
6. Open **Vexor Video -> All Videos** to find and copy shortcodes, or use `[vexor_player id="YOUR_ASSET_UUID"]` in any post, page, or lesson.

== Frequently Asked Questions ==

= Do I need a Vexor account to use this plugin? =
Yes. You need an active account and API key from [VEXOR](https://vexor-video.vercel.app/) to upload, transcode, and stream videos.

= Does this plugin work with LMS plugins like LearnDash or Tutor LMS? =
Yes. Use the `vexor_can_view_asset` PHP filter hook to tie video playback permissions directly to your LMS course enrollment rules.

= Where are videos stored and transcoded? =
Videos are transcoded and securely stored on Vexor's video infrastructure, ensuring your WordPress hosting server resources are not burdened by heavy video processing or delivery bandwidth.

== Screenshots ==

1. Vexor Video admin settings page.
2. Asset browser showing video thumbnails and shortcode copy action.
3. Embedded Vexor player with adaptive HLS playback.

== Changelog ==

= 0.3.0 =
* Initial release for WordPress.org Plugin Directory.
* Added viewer token authorization and automated token refresh.
* Added visible viewer watermark and context protection options.
* Added admin asset library and test connection action.
* Added HMAC-SHA256 verified webhook endpoints.

== Upgrade Notice ==

= 0.3.0 =
Initial release.
