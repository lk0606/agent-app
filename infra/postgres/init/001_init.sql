create table if not exists tasks (
  id text primary key,
  input text not null,
  status text not null,
  summary text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists messages (
  id bigserial primary key,
  task_id text not null references tasks(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_task_id_created_at
  on messages(task_id, created_at);

create table if not exists tool_calls (
  id bigserial primary key,
  task_id text not null references tasks(id) on delete cascade,
  step integer not null,
  tool_name text not null,
  tool_input text not null,
  tool_output text,
  status text not null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_tool_calls_task_id_step
  on tool_calls(task_id, step);
