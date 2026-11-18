-- Keyword topic tags on chat transcripts (computed on write; also derived on read for older rows).
alter table public.ghostchat_logs
  add column if not exists topic_tags text[] not null default '{}';

create index if not exists ghostchat_logs_topic_tags_idx
  on public.ghostchat_logs using gin (topic_tags);
