create table if not exists sessions (
  id text primary key,
  title text,
  user_id text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_task_at timestamptz
);

alter table tasks
  add column if not exists session_id text references sessions(id) on delete set null;

create index if not exists idx_tasks_session_id_created_at
  on tasks(session_id, created_at);
