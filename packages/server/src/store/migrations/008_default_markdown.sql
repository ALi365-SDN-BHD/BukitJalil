-- Markdown is the built-in default content source, so old saved Markdown rows are no longer used.
DELETE FROM data_sources WHERE platform <> 'notion';
