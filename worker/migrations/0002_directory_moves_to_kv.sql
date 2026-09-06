-- The searchable instrument directory moves out of D1 and into KV.
--
-- Context: seeding this table with ~31,000 instruments cost 177,888 billable
-- D1 row writes -- 178% of the daily free-tier budget. Because that limit is
-- enforced per ACCOUNT, it blocked writes for an unrelated project for about
-- four hours on 2026-09-05.
--
-- The deeper problem was that 31,000 rows existed to serve a user who adds a
-- handful of instruments a year. Search is now live against the provider,
-- enriched from a KV directory that costs zero writes on an unchanged day.
--
-- `instruments` itself stays: a row is created here when, and only when, the
-- user saves an investment item, and `investment_items.instrument_id`
-- references it.
--
-- Dropping the FTS shadow tables and the two search-only indexes also cuts
-- the write amplification for that eventual row from 6 billable writes to
-- about 2 (the table row plus the one index still needed to find it).

DROP TRIGGER IF EXISTS `instruments_fts_after_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `instruments_fts_after_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `instruments_fts_after_delete`;
--> statement-breakpoint
DROP TABLE IF EXISTS `instruments_fts`;
--> statement-breakpoint
-- Search-only indexes. Lookups now happen by (provider, provider_instrument_id),
-- which ux_instruments_provider_id still covers.
DROP INDEX IF EXISTS `ix_instruments_symbol_mic`;
--> statement-breakpoint
DROP INDEX IF EXISTS `ix_instruments_isin`;
