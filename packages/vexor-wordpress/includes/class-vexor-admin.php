<?php
/**
 * WP-Admin Settings and Video Management Interface.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Vexor_Admin {

    public static function init() {
        add_action('admin_menu', array(__CLASS__, 'add_admin_menu'));
        add_action('admin_init', array(__CLASS__, 'register_settings'));
        add_action('wp_ajax_vexor_test_connection', array(__CLASS__, 'ajax_test_connection'));
        add_action('admin_enqueue_scripts', array(__CLASS__, 'enqueue_admin_assets'));
    }

    public static function enqueue_admin_assets($hook) {
        if (strpos($hook, 'vexor') === false) {
            return;
        }

        wp_enqueue_style(
            'vexor-admin-css',
            plugins_url('assets/css/vexor-admin.css', dirname(__FILE__)),
            array(),
            VEXOR_VERSION
        );

        wp_enqueue_script(
            'vexor-admin-js',
            plugins_url('assets/js/vexor-admin.js', dirname(__FILE__)),
            array('jquery'),
            VEXOR_VERSION,
            true
        );

        wp_localize_script('vexor-admin-js', 'vexorAdmin', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce'    => wp_create_nonce('vexor_admin_nonce'),
        ));
    }

    public static function add_admin_menu() {
        $icon_url = plugins_url('assets/images/vexor-mark.svg', dirname(__FILE__));
        add_menu_page(
            __('Vexor Video', 'vexor-video-platform'),
            __('Vexor Video', 'vexor-video-platform'),
            'manage_options',
            'vexor-videos',
            array(__CLASS__, 'render_videos_page'),
            $icon_url,
            30
        );

        add_submenu_page(
            'vexor-videos',
            __('All Videos', 'vexor-video-platform'),
            __('All Videos', 'vexor-video-platform'),
            'manage_options',
            'vexor-videos',
            array(__CLASS__, 'render_videos_page')
        );

        add_submenu_page(
            'vexor-videos',
            __('Settings', 'vexor-video-platform'),
            __('Settings', 'vexor-video-platform'),
            'manage_options',
            'vexor-settings',
            array(__CLASS__, 'render_settings_page')
        );
    }

    public static function register_settings() {
        register_setting('vexor_settings_group', 'vexor_api_key', array('sanitize_callback' => array(__CLASS__, 'sanitize_api_key')));
        register_setting('vexor_settings_group', 'vexor_base_url', array('sanitize_callback' => array(__CLASS__, 'sanitize_base_url')));
        register_setting('vexor_settings_group', 'vexor_webhook_secret', array('sanitize_callback' => array(__CLASS__, 'sanitize_webhook_secret')));
        register_setting('vexor_settings_group', 'vexor_watermark_template', array('sanitize_callback' => 'sanitize_text_field'));
        register_setting('vexor_settings_group', 'vexor_protect_default', array(
            'sanitize_callback' => function ($value) { return $value === 'yes' ? 'yes' : 'no'; },
        ));
    }

    public static function sanitize_api_key($value) {
        if (!empty($_POST['vexor_clear_api_key'])) {
            return '';
        }
        $value = sanitize_text_field(trim((string) wp_unslash($value)));
        return $value !== '' ? $value : get_option('vexor_api_key', '');
    }

    public static function sanitize_webhook_secret($value) {
        if (!empty($_POST['vexor_clear_webhook_secret'])) {
            return '';
        }
        $value = sanitize_text_field(trim((string) wp_unslash($value)));
        return $value !== '' ? $value : get_option('vexor_webhook_secret', '');
    }

    public static function sanitize_base_url($value) {
        $value = esc_url_raw(trim((string) wp_unslash($value)), array('https', 'http'));
        $parts = wp_parse_url($value);
        $host = isset($parts['host']) ? strtolower($parts['host']) : '';
        $local = in_array($host, array('localhost', '127.0.0.1', '::1', 'host.docker.internal'), true);
        $valid = !empty($parts['scheme']) && $host !== '' && !isset($parts['user']) && !isset($parts['pass']) &&
            !isset($parts['query']) && !isset($parts['fragment']) &&
            ($parts['scheme'] === 'https' || ($parts['scheme'] === 'http' && $local && defined('WP_DEBUG') && WP_DEBUG));
        if (!$valid) {
            add_settings_error('vexor_base_url', 'invalid_vexor_base_url', __('Use an HTTPS Vexor API URL. HTTP is allowed only for localhost while WP_DEBUG is enabled.', 'vexor-video-platform'));
            return get_option('vexor_base_url', 'https://vexor-video.vercel.app');
        }
        return untrailingslashit($value);
    }

    public static function ajax_test_connection() {
        check_ajax_referer('vexor_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(array('message' => __('Unauthorized', 'vexor-video-platform')));
        }

        $result = Vexor_API::test_connection();
        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    public static function render_settings_page() {
        ?>
        <div class="wrap vexor-admin-wrap">
            <div class="vexor-admin-header" style="display:flex;align-items:center;gap:14px;margin-bottom:20px;padding:12px 18px;background:#16120f;border:1px solid rgba(255,255,255,0.1);border-radius:6px;">
                <img src="<?php echo esc_url(plugins_url('assets/images/icon-128x128.png', dirname(__FILE__))); ?>" alt="Vexor" width="40" height="40" style="display:block;border-radius:4px;">
                <div>
                    <h1 style="margin:0;font-size:18px;font-weight:600;color:#ffffff;line-height:1.2;"><?php esc_html_e('Vexor Video Platform Settings', 'vexor-video-platform'); ?></h1>
                    <span style="font-size:11px;font-family:monospace;color:#ec6d1c;text-transform:uppercase;letter-spacing:0.05em;"><?php esc_html_e('Secure HLS Video Infrastructure', 'vexor-video-platform'); ?> · v<?php echo esc_html(VEXOR_VERSION); ?></span>
                </div>
            </div>
            <p class="description">
                <?php esc_html_e('Configure Vexor playback and webhook credentials. The visible watermark and right-click suppression are deterrents, not DRM or capture prevention.', 'vexor-video-platform'); ?>
            </p>

            <form method="post" action="options.php">
                <?php settings_fields('vexor_settings_group'); ?>
                <?php do_settings_sections('vexor_settings_group'); ?>

                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="vexor_api_key"><?php esc_html_e('API Key', 'vexor-video-platform'); ?></label></th>
                        <td>
                            <input name="vexor_api_key" type="password" id="vexor_api_key" value="" class="regular-text" placeholder="<?php echo esc_attr(empty(get_option('vexor_api_key')) ? 'vex_live_...' : __('Saved — enter a new key to replace', 'vexor-video-platform')); ?>" autocomplete="new-password">
                            <label><input name="vexor_clear_api_key" type="checkbox" value="1"> <?php esc_html_e('Clear saved API key', 'vexor-video-platform'); ?></label>
                            <p class="description"><?php esc_html_e('The saved key is never rendered into this page. Leave blank to keep the current key.', 'vexor-video-platform'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="vexor_base_url"><?php esc_html_e('API Base URL', 'vexor-video-platform'); ?></label></th>
                        <td>
                            <input name="vexor_base_url" type="url" id="vexor_base_url" value="<?php echo esc_attr(get_option('vexor_base_url', 'https://vexor-video.vercel.app')); ?>" class="regular-text" placeholder="https://vexor-video.vercel.app">
                            <p class="description"><?php esc_html_e('Your deployed Vexor API or platform origin (e.g. https://vexor-video.vercel.app). HTTP localhost is allowed only when WP_DEBUG is enabled.', 'vexor-video-platform'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="vexor_webhook_secret"><?php esc_html_e('Webhook Secret', 'vexor-video-platform'); ?></label></th>
                        <td>
                            <input name="vexor_webhook_secret" type="password" id="vexor_webhook_secret" value="" class="regular-text" placeholder="<?php echo esc_attr(empty(get_option('vexor_webhook_secret')) ? 'whsec_...' : __('Saved — enter a new secret to replace', 'vexor-video-platform')); ?>" autocomplete="new-password">
                            <label><input name="vexor_clear_webhook_secret" type="checkbox" value="1"> <?php esc_html_e('Clear saved webhook secret', 'vexor-video-platform'); ?></label>
                            <p class="description"><?php esc_html_e('Required to accept Vexor webhooks. Leave blank to keep the current secret.', 'vexor-video-platform'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="vexor_watermark_template"><?php esc_html_e('Watermark Template', 'vexor-video-platform'); ?></label></th>
                        <td>
                            <input name="vexor_watermark_template" type="text" id="vexor_watermark_template" value="<?php echo esc_attr(get_option('vexor_watermark_template', '{name} · {id}')); ?>" class="regular-text">
                            <p class="description">
                                <?php esc_html_e('Visible overlay that may discourage casual sharing; it cannot prevent screen capture. Consider using an internal ID instead of personal data. Variables: {name}, {email}, {username}, {id}.', 'vexor-video-platform'); ?>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Casual-Copy Deterrents', 'vexor-video-platform'); ?></th>
                        <td>
                            <input type="hidden" name="vexor_protect_default" value="no">
                            <label>
                                <input name="vexor_protect_default" type="checkbox" value="yes" <?php checked(get_option('vexor_protect_default', 'yes'), 'yes'); ?>>
                                <?php esc_html_e('Suppress the context menu and video dragging as a casual-copy deterrent. This does not prevent capture or replace access controls.', 'vexor-video-platform'); ?>
                            </label>
                        </td>
                    </tr>
                </table>

                <div style="margin: 20px 0; display:flex; align-items:center; gap:12px;">
                    <?php submit_button(__('Save Settings', 'vexor-video-platform'), 'primary', 'submit', false); ?>
                    <button type="button" id="vexor-test-btn" class="button button-secondary">
                        <?php esc_html_e('Test Connection', 'vexor-video-platform'); ?>
                    </button>
                    <span id="vexor-test-result" style="font-weight: 500;"></span>
                </div>
            </form>
        </div>
        <?php
    }

    public static function render_videos_page() {
        $assets = Vexor_API::list_assets(50, 0);
        $thumbnail_urls = array();
        if (is_array($assets) && !empty($assets)) {
            $asset_ids = array();
            foreach ($assets as $asset) {
                if (!empty($asset['id'])) $asset_ids[] = $asset['id'];
            }
            $thumbnail_result = Vexor_API::get_thumbnail_urls($asset_ids);
            if (is_array($thumbnail_result)) $thumbnail_urls = $thumbnail_result;
        }
        ?>
        <div class="wrap vexor-admin-wrap">
            <div class="vexor-admin-header" style="display:flex;align-items:center;gap:14px;margin-bottom:20px;padding:12px 18px;background:#16120f;border:1px solid rgba(255,255,255,0.1);border-radius:6px;">
                <img src="<?php echo esc_url(plugins_url('assets/images/icon-128x128.png', dirname(__FILE__))); ?>" alt="Vexor" width="40" height="40" style="display:block;border-radius:4px;">
                <div>
                    <h1 style="margin:0;font-size:18px;font-weight:600;color:#ffffff;line-height:1.2;"><?php esc_html_e('Vexor Video Assets', 'vexor-video-platform'); ?></h1>
                    <span style="font-size:11px;font-family:monospace;color:#ec6d1c;text-transform:uppercase;letter-spacing:0.05em;"><?php esc_html_e('Secure HLS Video Infrastructure', 'vexor-video-platform'); ?> · v<?php echo esc_html(VEXOR_VERSION); ?></span>
                </div>
            </div>
            <p class="description">
                <?php esc_html_e('Videos stored, encrypted, and distributed through Vexor. Copy the shortcode into any post, LearnDash lesson, or Tutor LMS course.', 'vexor-video-platform'); ?>
            </p>

            <?php if (empty(Vexor_API::get_api_key())) : ?>
                <div class="notice notice-warning inline" style="margin: 15px 0;">
                    <p>
                        <?php
                        /* translators: %s: Settings page link */
                        printf(
                            /* translators: %s: Settings page link */
                            esc_html__('Please configure your Vexor API Key in %s to view and embed videos.', 'vexor-video-platform'),
                            '<a href="' . esc_url(admin_url('admin.php?page=vexor-settings')) . '">' . esc_html__('Settings', 'vexor-video-platform') . '</a>'
                        ); ?>
                    </p>
                </div>
            <?php elseif (is_wp_error($assets)) : ?>
                <div class="notice notice-error inline" style="margin: 15px 0;">
                    <p><?php echo esc_html($assets->get_error_message()); ?></p>
                </div>
            <?php elseif (empty($assets)) : ?>
                <div class="notice notice-info inline" style="margin: 15px 0;">
                    <p><?php esc_html_e('No videos found in this Vexor account yet.', 'vexor-video-platform'); ?></p>
                </div>
            <?php else : ?>
                <table class="wp-list-table widefat fixed striped table-view-list" style="margin-top: 15px;">
                    <thead>
                        <tr>
                            <th style="width: 120px;"><?php esc_html_e('Thumbnail', 'vexor-video-platform'); ?></th>
                            <th><?php esc_html_e('Filename / Title', 'vexor-video-platform'); ?></th>
                            <th><?php esc_html_e('Asset ID', 'vexor-video-platform'); ?></th>
                            <th style="width: 110px;"><?php esc_html_e('Status', 'vexor-video-platform'); ?></th>
                            <th style="width: 100px;"><?php esc_html_e('Duration', 'vexor-video-platform'); ?></th>
                            <th style="width: 280px;"><?php esc_html_e('Shortcode', 'vexor-video-platform'); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($assets as $asset) :
                            $id = isset($asset['id']) ? $asset['id'] : '';
                            $name = isset($asset['filename']) ? $asset['filename'] : (isset($asset['title']) ? $asset['title'] : 'Untitled');
                            $state = isset($asset['state']) ? sanitize_key($asset['state']) : 'unknown';
                            $duration_seconds = isset($asset['duration_seconds']) ? max(0, (int) $asset['duration_seconds']) : 0;
                            $duration = $duration_seconds > 0
                                ? ($duration_seconds >= 3600 ? gmdate('H:i:s', $duration_seconds) : gmdate('i:s', $duration_seconds))
                                : '—';
                            $progress = isset($asset['progress_percent']) ? max(0, min(100, (int) $asset['progress_percent'])) : 0;
                            $shortcode = '[vexor_player id="' . esc_attr($id) . '"]';
                        ?>
                            <tr>
                                <td>
                                    <?php if (!empty($thumbnail_urls[$id])) : ?>
                                        <img src="<?php echo esc_url($thumbnail_urls[$id]); ?>" alt="<?php echo esc_attr($name); ?> thumbnail" loading="lazy" style="display:block;width:100px;aspect-ratio:16/9;object-fit:cover;background:#000;border-radius:4px;">
                                    <?php else : ?>
                                        <div aria-label="Thumbnail not ready" style="width:100px;aspect-ratio:16/9;background:#000;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:10px;">VEXOR</div>
                                    <?php endif; ?>
                                </td>
                                <td>
                                    <strong><?php echo esc_html($name); ?></strong>
                                </td>
                                <td>
                                    <code><?php echo esc_html($id); ?></code>
                                </td>
                                <td>
                                    <?php if ($state === 'ready') : ?>
                                        <span style="display:inline-block;padding:2px 8px;border-radius:12px;background:#d1fae5;color:#065f46;font-size:11px;font-weight:600;">Ready</span>
                                    <?php elseif ($state === 'preview_ready') : ?>
                                        <span style="display:inline-block;padding:2px 8px;border-radius:12px;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:600;">Preview ready</span>
                                    <?php elseif (in_array($state, array('uploading', 'uploaded', 'transcoding'), true)) : ?>
                                        <span style="display:inline-block;padding:2px 8px;border-radius:12px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600;"><?php echo esc_html(ucfirst($state)); ?><?php if ($state === 'transcoding') : ?> · <?php echo esc_html($progress); ?>%<?php endif; ?></span>
                                    <?php else : ?>
                                        <span style="display:inline-block;padding:2px 8px;border-radius:12px;background:#f3f4f6;color:#374151;font-size:11px;"><?php echo esc_html(ucfirst($state)); ?></span>
                                    <?php endif; ?>
                                </td>
                                <td><?php echo esc_html($duration); ?></td>
                                <td>
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <input type="text" readonly value="<?php echo esc_attr($shortcode); ?>" style="width: 200px; font-size: 11px; padding: 3px 6px;">
                                        <button type="button" class="button button-small vexor-copy-btn" data-clipboard="<?php echo esc_attr($shortcode); ?>">
                                            <?php esc_html_e('Copy', 'vexor-video-platform'); ?>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>
        <?php
    }
}
