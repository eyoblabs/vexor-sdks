<?php
/** Shortcode and per-viewer playback-token handlers. */

if (!defined('ABSPATH')) {
    exit;
}

class Vexor_Shortcode {

    public static function init() {
        add_shortcode('vexor_player', array(__CLASS__, 'render_shortcode'));
        add_shortcode('vexor_video', array(__CLASS__, 'render_shortcode'));
        add_action('wp_enqueue_scripts', array(__CLASS__, 'register_assets'));
        add_action('wp_ajax_vexor_playback_token', array(__CLASS__, 'ajax_playback_token'));
        add_action('wp_ajax_nopriv_vexor_playback_token', array(__CLASS__, 'ajax_playback_token'));
    }

    public static function register_assets() {
        $suffix = (defined('SCRIPT_DEBUG') && SCRIPT_DEBUG) ? '' : '.min';
        wp_register_style('vexor-player-css', VEXOR_PLUGIN_URL . 'assets/css/vexor-player.css', array(), VEXOR_VERSION);
        wp_register_script('vexor-player-js', VEXOR_PLUGIN_URL . 'assets/js/vexor-player' . $suffix . '.js', array(), VEXOR_VERSION, true);
        wp_register_script('vexor-embed-js', VEXOR_PLUGIN_URL . 'assets/js/vexor-embed.js', array('vexor-player-js'), VEXOR_VERSION, true);
    }

    public static function render_shortcode($atts) {
        $atts = shortcode_atts(array(
            'id' => '',
            'asset_id' => '',
            'poster' => '',
            'watermark' => 'default',
            'protect' => get_option('vexor_protect_default', 'yes') === 'yes' ? 'true' : 'false',
            'autoplay' => 'false',
            'muted' => 'false',
            'class' => '',
            'style' => '',
        ), $atts, 'vexor_player');

        $asset_id = sanitize_text_field(!empty($atts['id']) ? $atts['id'] : $atts['asset_id']);
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $asset_id)) {
            return '<div class="vexor-error-notice">' . esc_html__('[vexor_player] requires a valid Vexor asset UUID.', 'vexor-video-platform') . '</div>';
        }

        wp_enqueue_style('vexor-player-css');
        wp_enqueue_script('vexor-player-js');
        wp_enqueue_script('vexor-embed-js');
        wp_localize_script('vexor-embed-js', 'vexorPlayerConfig', array(
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('vexor_playback_token'),
            'loading' => __('Loading video…', 'vexor-video-platform'),
            'failed' => __('Video could not be loaded. Please try again later.', 'vexor-video-platform'),
            'retry' => __('Retry', 'vexor-video-platform'),
        ));

        $classes = array_filter(array_map('sanitize_html_class', preg_split('/\s+/', (string) $atts['class'])));
        $classes[] = 'vexor-player';
        $classes[] = 'vexor-player-embed';
        $style = safecss_filter_attr((string) $atts['style']);
        $watermark = sanitize_text_field((string) $atts['watermark']);
        $protect = in_array(strtolower((string) $atts['protect']), array('true', 'yes', '1'), true) ? 'true' : 'false';
        $autoplay = in_array(strtolower((string) $atts['autoplay']), array('true', 'yes', '1'), true) ? 'true' : 'false';
        $muted = in_array(strtolower((string) $atts['muted']), array('true', 'yes', '1'), true) ? 'true' : 'false';

        return sprintf(
            '<div class="%1$s" data-asset-id="%2$s" data-poster="%3$s" data-watermark="%4$s" data-protect="%5$s" data-autoplay="%6$s" data-muted="%7$s"%8$s></div>',
            esc_attr(implode(' ', $classes)),
            esc_attr($asset_id),
            esc_url($atts['poster']),
            esc_attr($watermark),
            esc_attr($protect),
            esc_attr($autoplay),
            esc_attr($muted),
            $style !== '' ? ' style="' . esc_attr($style) . '"' : ''
        );
    }

    public static function ajax_playback_token() {
        check_ajax_referer('vexor_playback_token', 'nonce');

        $asset_id = isset($_POST['asset_id']) ? sanitize_text_field(wp_unslash($_POST['asset_id'])) : '';
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $asset_id)) {
            wp_send_json_error(array('message' => __('Invalid video asset.', 'vexor-video-platform')), 400);
        }

        $user_id = get_current_user_id();
        // Fail closed unless the site explicitly grants access. A public AJAX
        // nonce is not authorization to issue playback tokens for any asset.
        if (!apply_filters('vexor_can_view_asset', false, $asset_id, $user_id)) {
            wp_send_json_error(array('message' => __('You do not have access to this video.', 'vexor-video-platform')), 403);
        }

        $viewer_id = $user_id ? 'wp_' . $user_id : 'guest';
        // Never send WordPress's raw authentication session token to Vexor.
        // Derive a stable, site-scoped opaque identifier for playback binding.
        $wordpress_session = wp_get_session_token();
        if ($wordpress_session !== '') {
            $session_id = 'wp_' . hash_hmac('sha256', $wordpress_session, wp_salt('auth'));
        } else {
            $session_id = 'wp_guest_' . wp_generate_password(32, false, false);
        }
        $result = Vexor_API::create_playback_token($asset_id, $viewer_id, $session_id);
        if (is_wp_error($result)) {
            $error_data = $result->get_error_data();
            $status = is_array($error_data) && isset($error_data['status']) ? (int) $error_data['status'] : 0;
            if ($result->get_error_code() === 'transcoding') $status = 409;
            if ($status < 400 || $status > 599) $status = 502;
            wp_send_json_error(array('message' => __('Vexor could not authorize this video right now.', 'vexor-video-platform')), $status);
        }

        $watermark = '';
        $mode = isset($_POST['watermark']) ? sanitize_text_field(wp_unslash($_POST['watermark'])) : 'default';
        if ($mode === 'default' && $user_id) {
            $user = wp_get_current_user();
            $template = get_option('vexor_watermark_template', '{name} · {id}');
            $watermark = str_replace(
                array('{name}', '{email}', '{username}', '{id}'),
                array($user->display_name, $user->user_email, $user->user_login, $user->ID),
                $template
            );
        } elseif ($mode !== 'default' && strtolower($mode) !== 'false' && $mode !== 'true') {
            $watermark = $mode;
        }

        wp_send_json_success(array(
            'token' => isset($result['token']) ? sanitize_text_field($result['token']) : '',
            'manifest_url' => esc_url_raw($result['manifest_url']),
            'thumbnail_url' => isset($result['thumbnail_url']) ? esc_url_raw($result['thumbnail_url']) : '',
            'watermark' => $watermark,
        ));
    }
}
