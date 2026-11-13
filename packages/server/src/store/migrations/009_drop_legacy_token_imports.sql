-- Version 9 once created legacy_token_imports for a one-time import of the old global tokens; that
-- import was removed because there was no installed base to upgrade. The number stays taken so a later
-- migration never reuses it (a database that ran the old 009 would skip it). Such a database keeps the
-- empty table, which nothing reads.
DROP TABLE IF EXISTS legacy_token_imports;
