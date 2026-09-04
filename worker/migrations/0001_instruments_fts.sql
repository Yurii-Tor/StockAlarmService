-- Full-text search over the instrument universe.
--
-- Drizzle cannot express FTS5 virtual tables, so this migration is hand-written.
--
-- This is the PRIMARY search path, not a fallback. Finnhub's /search returns
-- only symbol, description, displaySymbol and type -- no exchange, MIC or
-- currency -- and so cannot satisfy acceptance criterion 1 or the §B.1
-- duplicate-listing requirement. /stock/symbol?exchange=<X> does return mic,
-- currency and figi, so a nightly job syncs the universe into `instruments`
-- and search runs locally against this index. That also collapses the
-- provider rate-limit problem, since search makes no external call at all.
--
-- A standalone (rather than external-content) FTS table is used deliberately:
-- `instruments` has a TEXT primary key, and coupling the index to an implicit
-- rowid would make it fragile across future table rewrites.

CREATE VIRTUAL TABLE `instruments_fts` USING fts5(
  symbol,
  display_name,
  instrument_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `instruments_fts_after_insert` AFTER INSERT ON `instruments` BEGIN
  INSERT INTO `instruments_fts` (symbol, display_name, instrument_id)
  VALUES (new.symbol, new.display_name, new.id);
END;
--> statement-breakpoint
CREATE TRIGGER `instruments_fts_after_delete` AFTER DELETE ON `instruments` BEGIN
  DELETE FROM `instruments_fts` WHERE instrument_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `instruments_fts_after_update` AFTER UPDATE ON `instruments` BEGIN
  DELETE FROM `instruments_fts` WHERE instrument_id = old.id;
  INSERT INTO `instruments_fts` (symbol, display_name, instrument_id)
  VALUES (new.symbol, new.display_name, new.id);
END;
