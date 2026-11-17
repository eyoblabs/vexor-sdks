<?php
/**
 * REST API webhook endpoint handler for Vexor notifications.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Vexor_Webhooks {

    public static function init() {
        add_action('rest_api_init', array(__CLASS__, 'register_rest_routes'));
    }

    public static function register_rest_routes() {
        register_rest_route('vexor/v1', '/webhook', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'handle_webhook'),
            'permission_callback' => '__return_true',
        ));
    }

    public static function handle_webhook(WP_REST_Request $request) {
        $secret = Vexor_API::get_webhook_secret();
        if (empty($secret)) {
            return new WP_Error('webhook_not_configured', __('Webhook verification is not configured.', 'vexor-video-platform'), array('status' => 503));
        }

        $raw_body = $request->get_body();
        if (strlen($raw_body) > 1048576) {
            return new WP_Error('payload_too_large', __('Webhook payload is too large.', 'vexor-video-platform'), array('status' => 413));
        }

        $signature = trim((string) $request->get_header('x-vexor-signature'));
        if (stripos($signature, 'sha256=') === 0) {
            $signature = substr($signature, 7);
        }
        $expected = hash_hmac('sha256', $raw_body, $secret);
        if (!preg_match('/^[a-f0-9]{64}$/i', $signature) || !hash_equals($expected, strtolower($signature))) {
            return new WP_Error('invalid_signature', __('Invalid Vexor webhook signature.', 'vexor-video-platform'), array('status' => 401));
        }

        // Verify the exact signed bytes before parsing attacker-controlled JSON.
        $payload = json_decode($raw_body, true);
        if (!is_array($payload) || !is_string($payload['type'] ?? null) || !is_array($payload['data'] ?? null)) {
            return new WP_Error('invalid_payload', __('Invalid Vexor webhook payload.', 'vexor-video-platform'), array('status' => 400));
        }

        $event_id = $payload['event_id'] ?? '';
        $event_type = $payload['type'];
        $event_timestamp_value = $payload['timestamp'] ?? null;
        $event_timestamp = is_string($event_timestamp_value) ? strtotime($event_timestamp_value) : false;
        $header_timestamp = $request->get_header('x-vexor-timestamp');
        $header_event_id = $request->get_header('x-vexor-event-id');
        if (!is_string($event_id) || $event_id === '' || strlen($event_id) > 200 ||
            !preg_match('/^video\.[a-z0-9_.-]{1,80}$/', $event_type) ||
            !$event_timestamp || !preg_match('/^\d+$/', (string) $header_timestamp) ||
            (int) $header_timestamp !== $event_timestamp || !hash_equals($event_id, (string) $header_event_id)) {
            return new WP_Error('invalid_payload', __('Webhook event metadata is invalid.', 'vexor-video-platform'), array('status' => 400));
        }

        // The sender retries the original signed event, so deduplicate by the
        // signed event ID instead of rejecting valid delayed retries by age.
        $event_hash = hash('sha256', $event_id);
        $done_key = 'vexor_event_done_' . $event_hash;
        if (get_transient($done_key)) {
            return rest_ensure_response(array('received' => true, 'duplicate' => true));
        }

        $lock_key = 'vexor_event_lock_' . substr($event_hash, 0, 40);
        if (!add_option($lock_key, time(), '', false)) {
            $lock_time = (int) get_option($lock_key, 0);
            if ($lock_time > 0 && time() - $lock_time > 120) {
                delete_option($lock_key);
                if (!add_option($lock_key, time(), '', false)) {
                    return new WP_Error('webhook_in_progress', __('Webhook event is already being processed.', 'vexor-video-platform'), array('status' => 503));
                }
            } else {
                return new WP_Error('webhook_in_progress', __('Webhook event is already being processed.', 'vexor-video-platform'), array('status' => 503));
            }
        }

        try {
            $action = 'vexor_webhook_' . str_replace('.', '_', $event_type);
            do_action($action, $payload['data'], $payload);
            do_action('vexor_webhook_received', $event_type, $payload['data'], $payload);
            set_transient($done_key, 1, 30 * DAY_IN_SECONDS);
        } catch (Throwable $error) {
            delete_option($lock_key);
            return new WP_Error('webhook_handler_failed', __('Webhook handler failed; Vexor may retry delivery.', 'vexor-video-platform'), array('status' => 500));
        }

        delete_option($lock_key);
        return rest_ensure_response(array('received' => true));
    }
}
