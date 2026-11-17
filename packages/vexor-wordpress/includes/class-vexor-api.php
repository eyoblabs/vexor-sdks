<?php
/**
 * Vexor API Client for WordPress.
 * Uses the standard WordPress HTTP API (wp_remote_get, wp_remote_post).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Vexor_API {

    public static function get_base_url() {
        $url = get_option('vexor_base_url', 'https://vexor-video.vercel.app');
        $url = esc_url_raw(!empty($url) ? trim($url) : 'https://vexor-video.vercel.app', array('https', 'http'));
        $parts = wp_parse_url($url);
        if (empty($parts['scheme']) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
            return '';
        }

        $host = strtolower($parts['host']);
        $is_loopback = in_array($host, array('localhost', '127.0.0.1', '::1', 'host.docker.internal'), true);
        if ($parts['scheme'] !== 'https' && !($is_loopback && defined('WP_DEBUG') && WP_DEBUG)) {
            return '';
        }

        return untrailingslashit($url);
    }

    public static function get_api_key() {
        return get_option('vexor_api_key', '');
    }

    public static function get_webhook_secret() {
        return get_option('vexor_webhook_secret', '');
    }

    private static function get_headers() {
        return array(
            'Authorization' => 'Bearer ' . self::get_api_key(),
            'Content-Type'  => 'application/json',
            'Accept'        => 'application/json',
            'User-Agent'    => 'vexor-wordpress/' . VEXOR_VERSION . '; ' . home_url(),
        );
    }

    /**
     * Request a short-lived Ed25519 playback token and authenticated manifest URL.
     */
    public static function create_playback_token($asset_id, $viewer_id = '', $session_id = '') {
        if (empty($asset_id)) {
            return new WP_Error('missing_asset_id', __('Asset ID is required', 'vexor-video-platform'));
        }

        $base_url = self::get_base_url();
        if (empty($base_url) || empty(self::get_api_key())) {
            return new WP_Error('not_configured', __('Vexor API settings are incomplete or invalid.', 'vexor-video-platform'));
        }
        $url = $base_url . '/v1/tokens';
        $body = wp_json_encode(array(
            'asset_id'   => $asset_id,
            'viewer_id'  => !empty($viewer_id) ? $viewer_id : 'guest',
            'session_id' => !empty($session_id) ? $session_id : 'wp_sess_' . wp_generate_password(8, false),
        ));

        $response = wp_remote_post($url, array(
            'headers' => self::get_headers(),
            'body'    => $body,
            'timeout' => 15,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
        ));

        if (is_wp_error($response)) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code($response);
        $data = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($data)) {
            return new WP_Error('invalid_response', __('Vexor returned an invalid response.', 'vexor-video-platform'));
        }

        if ($code === 409) {
            return new WP_Error('transcoding', __('Video is still transcoding. Please try again shortly.', 'vexor-video-platform'));
        }

        if ($code !== 200 && $code !== 201) {
            $msg = isset($data['error']) ? (is_array($data['error']) ? $data['error']['message'] : $data['error']) : __('Failed to obtain playback token', 'vexor-video-platform');
            return new WP_Error('api_error', $msg, array('status' => $code));
        }

        if (empty($data['manifest_url'])) {
            return new WP_Error('invalid_response', __('Vexor did not return a playback manifest URL.', 'vexor-video-platform'));
        }

        return $data;
    }

    /**
     * Fetch asset metadata and status.
     */
    public static function get_asset($asset_id) {
        $base_url = self::get_base_url();
        if (empty($base_url) || empty(self::get_api_key())) {
            return new WP_Error('not_configured', __('Configure a valid Vexor API URL and API key.', 'vexor-video-platform'));
        }
        if (!is_string($asset_id) || $asset_id === '') {
            return new WP_Error('missing_asset_id', __('Asset ID is required.', 'vexor-video-platform'));
        }
        $url = $base_url . '/v1/assets/' . rawurlencode($asset_id);
        $response = wp_remote_get($url, array(
            'headers' => self::get_headers(),
            'timeout' => 15,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
        ));

        if (is_wp_error($response)) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code === 404) {
            return new WP_Error('not_found', __('Asset not found on Vexor.', 'vexor-video-platform'));
        }
        if ($code !== 200) {
            return new WP_Error('api_error', __('Could not load the video from Vexor.', 'vexor-video-platform'), array('status' => $code));
        }
        $body = json_decode(wp_remote_retrieve_body($response), true);
        return is_array($body) ? $body : new WP_Error('invalid_response', __('Vexor returned an invalid asset response.', 'vexor-video-platform'));
    }

    /**
     * List video assets in the Vexor account.
     */
    public static function list_assets($limit = 50, $cursor = '') {
        $base_url = self::get_base_url();
        if (empty($base_url) || empty(self::get_api_key())) {
            return new WP_Error('not_configured', __('Configure a valid Vexor API URL and API key.', 'vexor-video-platform'));
        }
        $query = array('limit' => min(100, max(1, absint($limit))));
        if (!empty($cursor)) {
            $query['cursor'] = sanitize_text_field($cursor);
        }
        $url = add_query_arg($query, $base_url . '/v1/assets/page');

        $response = wp_remote_get($url, array(
            'headers' => self::get_headers(),
            'timeout' => 15,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
        ));

        if (is_wp_error($response)) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if ($code !== 200) {
            return new WP_Error('api_error', __('Could not load videos from Vexor.', 'vexor-video-platform'), array('status' => $code));
        }
        if (!is_array($body) || !isset($body['data']) || !is_array($body['data'])) {
            return new WP_Error('invalid_response', __('Vexor returned an invalid video list.', 'vexor-video-platform'));
        }
        return $body['data'];
    }

    /**
     * Fetch short-lived thumbnail URLs for assets owned by this API key.
     * The Vexor endpoint omits assets that are not ready or are not owned by
     * the configured account.
     */
    public static function get_thumbnail_urls($asset_ids) {
        $asset_ids = array_values(array_unique(array_filter(array_map('sanitize_text_field', (array) $asset_ids))));
        if (empty($asset_ids) || count($asset_ids) > 100) {
            return new WP_Error('invalid_asset_ids', __('Select between 1 and 100 assets to load thumbnails.', 'vexor-video-platform'));
        }

        $base_url = self::get_base_url();
        if (empty($base_url) || empty(self::get_api_key())) {
            return new WP_Error('not_configured', __('Configure a valid Vexor API URL and API key.', 'vexor-video-platform'));
        }

        $response = wp_remote_post($base_url . '/v1/tokens/thumbnails', array(
            'headers' => self::get_headers(),
            'body' => wp_json_encode(array('asset_ids' => $asset_ids)),
            'timeout' => 15,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
        ));
        if (is_wp_error($response)) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if ($code !== 200 || !is_array($body) || !isset($body['thumbnail_urls']) || !is_array($body['thumbnail_urls'])) {
            return new WP_Error('thumbnail_request_failed', __('Vexor could not return asset thumbnails.', 'vexor-video-platform'), array('status' => $code));
        }

        $urls = array();
        foreach ($body['thumbnail_urls'] as $asset_id => $url) {
            if (is_string($url) && wp_http_validate_url($url)) {
                $urls[sanitize_text_field($asset_id)] = esc_url_raw($url);
            }
        }
        return $urls;
    }

    /**
     * Delete an asset and purge its HLS files from edge storage.
     */
    public static function delete_asset($asset_id) {
        $base_url = self::get_base_url();
        if (empty($base_url) || empty(self::get_api_key())) {
            return new WP_Error('not_configured', __('Configure a valid Vexor API URL and API key.', 'vexor-video-platform'));
        }
        if (!is_string($asset_id) || $asset_id === '') {
            return new WP_Error('missing_asset_id', __('Asset ID is required.', 'vexor-video-platform'));
        }
        $url = $base_url . '/v1/assets/' . rawurlencode($asset_id);
        $response = wp_remote_request($url, array(
            'method'  => 'DELETE',
            'headers' => self::get_headers(),
            'timeout' => 15,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
        ));

        if (is_wp_error($response)) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code($response);
        return in_array($code, array(200, 202, 204), true);
    }

    /**
     * Test API connection with the configured API key and Base URL.
     */
    public static function test_connection() {
        $key = self::get_api_key();
        $base_url = self::get_base_url();
        if (empty($key) || empty($base_url)) {
            return array('success' => false, 'message' => __('Configure a valid API key and HTTPS API URL.', 'vexor-video-platform'));
        }

        $url = $base_url . '/v1/billing/balance';
        $response = wp_remote_get($url, array(
            'headers' => self::get_headers(),
            'timeout' => 10,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
        ));

        if (is_wp_error($response)) {
            return array('success' => false, 'message' => $response->get_error_message());
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code === 200) {
            $data = json_decode(wp_remote_retrieve_body($response), true);
            $balance = isset($data['balance_etb']) ? $data['balance_etb'] . ' ETB' : (isset($data['balance_santim']) ? ($data['balance_santim'] / 100) . ' ETB' : 'Connected');
            return array(
                'success' => true,
                /* translators: %s: Wallet balance formatted with currency */
                'message' => sprintf(__('Connected to Vexor successfully! Wallet balance: %s', 'vexor-video-platform'), $balance),
            );
        }

        if ($code === 401) {
            return array('success' => false, 'message' => __('Invalid API Key (HTTP 401 Unauthorized).', 'vexor-video-platform'));
        }

        /* translators: %d: HTTP status code returned by the API */
        return array('success' => false, 'message' => sprintf(__('API responded with HTTP %d', 'vexor-video-platform'), $code));
    }
}
