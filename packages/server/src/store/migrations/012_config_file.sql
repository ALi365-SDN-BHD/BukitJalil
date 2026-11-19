-- The root file Bukit reads as the site's config. It is found by content when a site is imported, so it
-- need not be called site.yaml; every site created by BukitJalil keeps the default.
ALTER TABLE sites ADD COLUMN config_file TEXT NOT NULL DEFAULT 'site.yaml';
