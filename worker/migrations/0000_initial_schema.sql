CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_accounts_provider_account` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `ix_accounts_user` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `notification_email_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`address` text NOT NULL,
	`verified_at` integer,
	`verification_token_hash` text,
	`verification_expires_at` integer,
	`verification_attempts` integer DEFAULT 0 NOT NULL,
	`unsubscribed_at` integer,
	`unsubscribe_token_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_notification_email_user` ON `notification_email_addresses` (`user_id`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'onesignal' NOT NULL,
	`provider_subscription_id` text NOT NULL,
	`external_id` text NOT NULL,
	`platform` text,
	`user_agent` text,
	`label` text,
	`permission_state` text DEFAULT 'default' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_push_permission_state" CHECK(permission_state in ('granted', 'denied', 'default')),
	CONSTRAINT "ck_push_platform" CHECK(platform in ('ios_web', 'android_web', 'desktop_web'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_push_subscription_provider` ON `push_subscriptions` (`provider`,`provider_subscription_id`);--> statement-breakpoint
CREATE INDEX `ix_push_subscriptions_user` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_sessions_token` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `ix_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`default_timezone` text DEFAULT 'Europe/Bucharest' NOT NULL,
	`default_new_item_status` text DEFAULT 'watching' NOT NULL,
	`default_review_plan_mode` text DEFAULT 'none' NOT NULL,
	`default_review_plan_preset` text,
	`default_review_channels` text DEFAULT '["in_app"]' NOT NULL,
	`default_price_alert_channels` text DEFAULT '["push","in_app"]' NOT NULL,
	`default_pre_review_channels` text DEFAULT '["in_app"]' NOT NULL,
	`prefill_entry_price_from_latest_quote` integer DEFAULT true NOT NULL,
	`default_broker_name` text,
	`last_used_broker_name` text,
	`lock_screen_privacy` text DEFAULT 'minimal' NOT NULL,
	`quiet_hours_enabled` integer DEFAULT false NOT NULL,
	`quiet_hours_start` text,
	`quiet_hours_end` text,
	`quiet_hours_apply_to_email` integer DEFAULT false NOT NULL,
	`overdue_digest_mode` text DEFAULT 'off' NOT NULL,
	`in_app_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_settings_new_item_status" CHECK(default_new_item_status in ('watching', 'open')),
	CONSTRAINT "ck_settings_review_mode" CHECK(default_review_plan_mode in ('none', 'date', 'recurring')),
	CONSTRAINT "ck_settings_privacy" CHECK(lock_screen_privacy in ('minimal', 'standard', 'detailed')),
	CONSTRAINT "ck_settings_digest" CHECK(overdue_digest_mode in ('off', 'daily', 'weekly'))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`status` text DEFAULT 'active' NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ck_users_status" CHECK(status in ('active', 'pending_deletion', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_verifications_identifier` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `instrument_quote_history` (
	`instrument_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`price` text NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_quote_history` ON `instrument_quote_history` (`instrument_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `ix_quote_history_observed` ON `instrument_quote_history` (`observed_at`);--> statement-breakpoint
CREATE TABLE `instrument_quotes` (
	`instrument_id` text PRIMARY KEY NOT NULL,
	`last_price` text,
	`currency` text,
	`quote_as_of` integer NOT NULL,
	`retrieved_at` integer NOT NULL,
	`delay_minutes` integer DEFAULT 0 NOT NULL,
	`freshness` text NOT NULL,
	`source` text NOT NULL,
	`previous_close` text,
	`day_open` text,
	`day_high` text,
	`day_low` text,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_quote_freshness" CHECK(freshness in ('realtime', 'delayed', 'stale', 'unavailable'))
);
--> statement-breakpoint
CREATE INDEX `ix_quotes_retrieved_at` ON `instrument_quotes` (`retrieved_at`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_instrument_id` text NOT NULL,
	`symbol` text NOT NULL,
	`display_name` text NOT NULL,
	`asset_type` text NOT NULL,
	`exchange` text,
	`mic` text,
	`currency` text,
	`country` text,
	`isin` text,
	`figi` text,
	`is_monitorable` integer DEFAULT true NOT NULL,
	`metadata_updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_instruments_provider_id` ON `instruments` (`provider`,`provider_instrument_id`);--> statement-breakpoint
CREATE INDEX `ix_instruments_symbol_mic` ON `instruments` (`symbol`,`mic`);--> statement-breakpoint
CREATE INDEX `ix_instruments_isin` ON `instruments` (`isin`);--> statement-breakpoint
CREATE TABLE `investment_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`instrument_id` text,
	`symbol` text NOT NULL,
	`display_name` text NOT NULL,
	`asset_type` text NOT NULL,
	`exchange` text,
	`currency` text NOT NULL,
	`status` text DEFAULT 'watching' NOT NULL,
	`timezone` text NOT NULL,
	`closed_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_item_status" CHECK(status in ('watching', 'open', 'closed', 'archived')),
	CONSTRAINT "ck_item_manual_has_metadata" CHECK(instrument_id is not null or (symbol <> '' and display_name <> '' and currency is not null))
);
--> statement-breakpoint
CREATE INDEX `ix_items_user_status` ON `investment_items` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_items_instrument` ON `investment_items` (`instrument_id`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`investment_item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`body` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`review_occurrence_id` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`investment_item_id`) REFERENCES `investment_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_journal_kind" CHECK(kind in ('note', 'review', 'decision', 'event'))
);
--> statement-breakpoint
CREATE INDEX `ix_journal_item_time` ON `journal_entries` (`investment_item_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `lots` (
	`id` text PRIMARY KEY NOT NULL,
	`investment_item_id` text NOT NULL,
	`bought_at` integer NOT NULL,
	`quantity` text NOT NULL,
	`entry_price` text NOT NULL,
	`currency` text NOT NULL,
	`fees` text DEFAULT '0' NOT NULL,
	`broker_name` text,
	`status` text DEFAULT 'open' NOT NULL,
	`entry_price_source` text NOT NULL,
	`entry_price_quote_as_of` integer,
	`sold_at` integer,
	`exit_price` text,
	`exit_fees` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`investment_item_id`) REFERENCES `investment_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_lot_status" CHECK(status in ('open', 'closed')),
	CONSTRAINT "ck_lot_price_source" CHECK(entry_price_source in ('manual', 'latest_quote')),
	CONSTRAINT "ck_lot_quantity_positive" CHECK(cast(quantity as real) > 0),
	CONSTRAINT "ck_lot_entry_price_non_negative" CHECK(cast(entry_price as real) >= 0),
	CONSTRAINT "ck_lot_fees_non_negative" CHECK(cast(fees as real) >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_lots_item` ON `lots` (`investment_item_id`);--> statement-breakpoint
CREATE TABLE `price_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`investment_item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`direction` text NOT NULL,
	`threshold_price` text NOT NULL,
	`currency` text NOT NULL,
	`channels` text,
	`is_passive` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`armed` integer DEFAULT true NOT NULL,
	`cooldown_until` integer,
	`triggered_at` integer,
	`triggered_price` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`investment_item_id`) REFERENCES `investment_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_target_kind" CHECK(kind in ('base_target', 'take_profit', 'stop_loss', 'custom')),
	CONSTRAINT "ck_target_direction" CHECK(direction in ('above', 'below', 'crosses_above', 'crosses_below')),
	CONSTRAINT "ck_target_status" CHECK(status in ('active', 'triggered', 'paused', 'disabled', 'not_monitorable')),
	CONSTRAINT "ck_target_channels_json" CHECK(channels is null or json_valid(channels))
);
--> statement-breakpoint
CREATE INDEX `ix_targets_item` ON `price_targets` (`investment_item_id`);--> statement-breakpoint
CREATE TABLE `theses` (
	`id` text PRIMARY KEY NOT NULL,
	`investment_item_id` text NOT NULL,
	`current_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`investment_item_id`) REFERENCES `investment_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_thesis_item` ON `theses` (`investment_item_id`);--> statement-breakpoint
CREATE TABLE `thesis_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_template_user_name` ON `thesis_templates` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `thesis_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`body` text NOT NULL,
	`template_id` text,
	`change_summary` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_thesis_version_no` ON `thesis_versions` (`thesis_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `ix_thesis_versions` ON `thesis_versions` (`thesis_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `review_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`review_reminder_id` text NOT NULL,
	`user_id` text NOT NULL,
	`investment_item_id` text NOT NULL,
	`occurrence_utc` integer NOT NULL,
	`occurrence_local_date` text NOT NULL,
	`occurrence_local_time` text NOT NULL,
	`kind` text DEFAULT 'review' NOT NULL,
	`pre_alert_offset` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`dispatched_at` integer,
	`completed_at` integer,
	`notification_event_id` text,
	`journal_entry_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_reminder_id`) REFERENCES `review_reminders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`investment_item_id`) REFERENCES `investment_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_occurrence_kind" CHECK(kind in ('review', 'pre_alert')),
	CONSTRAINT "ck_occurrence_state" CHECK(state in ('pending', 'dispatched', 'skipped_silent', 'completed', 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_occurrence_identity` ON `review_occurrences` (`review_reminder_id`,`occurrence_utc`,`kind`,`pre_alert_offset`);--> statement-breakpoint
CREATE INDEX `ix_occurrences_user_time` ON `review_occurrences` (`user_id`,`occurrence_utc`);--> statement-breakpoint
CREATE INDEX `ix_occurrences_state` ON `review_occurrences` (`state`,`occurrence_utc`);--> statement-breakpoint
CREATE TABLE `review_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`investment_item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`timezone` text NOT NULL,
	`local_time_of_day` text NOT NULL,
	`repeat_rule` text DEFAULT 'none' NOT NULL,
	`repeat_until` integer,
	`repeat_count` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`channels` text,
	`pre_alert_offsets` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`next_occurrence_utc` integer,
	`last_occurrence_utc` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`investment_item_id`) REFERENCES `investment_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_reminder_status" CHECK(status in ('scheduled', 'active', 'completed', 'cancelled')),
	CONSTRAINT "ck_reminder_channels_json" CHECK(channels is null or json_valid(channels)),
	CONSTRAINT "ck_reminder_pre_alerts_json" CHECK(json_valid(pre_alert_offsets))
);
--> statement-breakpoint
CREATE INDEX `ix_reminders_due` ON `review_reminders` (`next_occurrence_utc`);--> statement-breakpoint
CREATE INDEX `ix_reminders_item` ON `review_reminders` (`investment_item_id`);--> statement-breakpoint
CREATE INDEX `ix_reminders_user` ON `review_reminders` (`user_id`);--> statement-breakpoint
CREATE TABLE `account_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer NOT NULL,
	`scheduled_purge_at` integer NOT NULL,
	`confirmed_at` integer,
	`cancelled_at` integer,
	`purged_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `data_export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`format` text DEFAULT 'json' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`object_key` text,
	`download_token_hash` text,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer,
	`response_body` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_idempotency_user_key` ON `idempotency_keys` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`notification_event_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`deep_link` text,
	`category` text,
	`read_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notification_event_id`) REFERENCES `notification_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_inbox_event` ON `inbox_items` (`notification_event_id`);--> statement-breakpoint
CREATE INDEX `ix_inbox_user_created` ON `inbox_items` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_inbox_unread` ON `inbox_items` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_event_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`next_attempt_at` integer,
	`attempted_at` integer,
	`completed_at` integer,
	`provider` text,
	`provider_message_id` text,
	`provider_response` text,
	`error_code` text,
	`error_message` text,
	`skipped_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`notification_event_id`) REFERENCES `notification_events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_delivery_channel" CHECK(channel in ('push', 'email', 'in_app')),
	CONSTRAINT "ck_delivery_status" CHECK(status in ('pending', 'queued', 'sending', 'sent', 'failed', 'skipped', 'expired')),
	CONSTRAINT "ck_delivery_skipped_reason" CHECK(skipped_reason in ('email_unverified', 'email_unsubscribed', 'no_push_subscription', 'push_permission_denied', 'channel_disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_delivery_event_channel` ON `notification_deliveries` (`notification_event_id`,`channel`);--> statement-breakpoint
CREATE INDEX `ix_delivery_retry` ON `notification_deliveries` (`channel`,`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `notification_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`occurrence_utc` integer NOT NULL,
	`channels_requested` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`deduplication_key` text NOT NULL,
	`payload` text NOT NULL,
	`available_after` integer NOT NULL,
	`quiet_hours_deferred_from` integer,
	`is_critical` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_event_source_type" CHECK(source_type in ('review_reminder', 'pre_review_alert', 'price_target', 'digest', 'system')),
	CONSTRAINT "ck_event_status" CHECK(status in ('pending', 'processing', 'partially_delivered', 'delivered', 'failed', 'cancelled')),
	CONSTRAINT "ck_event_has_channels" CHECK(json_valid(channels_requested) and json_array_length(channels_requested) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_notification_events_dedup` ON `notification_events` (`deduplication_key`);--> statement-breakpoint
CREATE INDEX `ix_events_dispatch` ON `notification_events` (`status`,`available_after`);--> statement-breakpoint
CREATE INDEX `ix_events_user_created` ON `notification_events` (`user_id`,`created_at`);