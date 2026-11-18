-- Stage G9: allow FAQ documents (approve + CSV import). ghostchat_ tables only.

ALTER TABLE public.ghostchat_documents
  DROP CONSTRAINT IF EXISTS ghostchat_documents_source_type_check;

ALTER TABLE public.ghostchat_documents
  ADD CONSTRAINT ghostchat_documents_source_type_check
  CHECK (source_type IN ('crawl', 'upload', 'paste', 'pdf', 'notion', 'lookup', 'faq'));
