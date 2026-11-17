<?php
/**
 * Plugin Name: Vexor Video Platform
 * Plugin URI: https://github.com/eyob13-coder/Vexor-/tree/main/packages/vexor-wordpress
 * Description: Embed Vexor adaptive HLS videos in WordPress with viewer-specific playback tokens and optional visible watermarks.
 * Version: 0.3.0
 * Author: Eyob Geremew
 * Author URI: https://vexor-video.vercel.app/
 * License: GPL-2.0+
 * License URI: http://www.gnu.org/licenses/gpl-2.0.txt
 * Text Domain: vexor-video-platform
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

define('VEXOR_VERSION', '0.3.0');
define('VEXOR_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('VEXOR_PLUGIN_URL', plugin_dir_url(__FILE__));

// Load includes
require_once VEXOR_PLUGIN_DIR . 'includes/class-vexor-api.php';
require_once VEXOR_PLUGIN_DIR . 'includes/class-vexor-shortcode.php';
require_once VEXOR_PLUGIN_DIR . 'includes/class-vexor-admin.php';
require_once VEXOR_PLUGIN_DIR . 'includes/class-vexor-webhooks.php';

function vexor_video_init() {
    Vexor_Shortcode::init();
    Vexor_Webhooks::init();

    if (is_admin()) {
        Vexor_Admin::init();
    }
}
add_action('plugins_loaded', 'vexor_video_init');

// Add settings link to Plugins page
function vexor_video_action_links($links) {
    $settings_link = '<a href="' . admin_url('admin.php?page=vexor-settings') . '">' . __('Settings', 'vexor-video-platform') . '</a>';
    array_unshift($links, $settings_link);
    return $links;
}
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'vexor_video_action_links');
