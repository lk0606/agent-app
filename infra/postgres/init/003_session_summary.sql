alter table sessions
  add column if not exists summary text,
  add column if not exists summary_message_count integer not null default 0,
  add column if not exists summary_updated_at timestamptz;
