<?php
/**
 * Plugin Name: GhostChat
 * Description: Adds the GhostChat assistant widget to your WordPress site.
 * Version: 1.0.0
 * Author: GhostChat
 * Author URI: https://ghostchat.pro
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

if (!defined('ABSPATH')) {
    exit;
}

function ghostchat_default_script_url() {
    return 'https://ghostchat.pro/widget.js';
}

add_action('admin_menu', function () {
    add_options_page('GhostChat', 'GhostChat', 'manage_options', 'ghostchat', 'ghostchat_render_settings');
});

add_action('admin_init', function () {
    register_setting('ghostchat', 'ghostchat_site_key', [
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => '',
    ]);
    register_setting('ghostchat', 'ghostchat_script_url', [
        'type' => 'string',
        'sanitize_callback' => 'esc_url_raw',
        'default' => ghostchat_default_script_url(),
    ]);
});

function ghostchat_render_settings() {
    if (!current_user_can('manage_options')) {
        return;
    }
    echo '<div class="wrap"><h1>GhostChat</h1>';
    echo '<p>Paste the site key from your GhostChat dashboard. The widget is added to every public page.</p>';
    echo '<form method="post" action="options.php">';
    settings_fields('ghostchat');
    echo '<table class="form-table" role="presentation"><tr><th scope="row"><label for="ghostchat_site_key">Site key</label></th><td>';
    echo '<input name="ghostchat_site_key" id="ghostchat_site_key" type="text" class="regular-text" value="' . esc_attr(get_option('ghostchat_site_key', '')) . '" placeholder="gc_..." /></td></tr>';
    echo '<tr><th scope="row"><label for="ghostchat_script_url">Widget script URL</label></th><td>';
    echo '<input name="ghostchat_script_url" id="ghostchat_script_url" type="url" class="regular-text" value="' . esc_attr(get_option('ghostchat_script_url', ghostchat_default_script_url())) . '" /></td></tr></table>';
    submit_button('Save');
    echo '</form></div>';
}

add_action('wp_footer', function () {
    $key = trim((string) get_option('ghostchat_site_key', ''));
    if ($key === '' || !preg_match('/^gc_[A-Za-z0-9_-]+$/', $key)) {
        return;
    }
    $src = trim((string) get_option('ghostchat_script_url', ''));
    if ($src === '') {
        $src = ghostchat_default_script_url();
    }
    echo '<script src="' . esc_url($src) . '" data-id="' . esc_attr($key) . '" async></script>' . "\n";
}, 99);
