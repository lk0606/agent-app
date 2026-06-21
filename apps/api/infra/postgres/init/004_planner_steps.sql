-- Planner 每轮 llm.plan 的决策快照（needs_tool / outcome / duration_ms）。
-- 与 tool_calls 区分：tool_calls 记录「工具实际执行」，本表记录「为何选这个工具」。
create table if not exists planner_steps (
  id bigserial primary key,
  task_id text not null references tasks(id) on delete cascade,
  step integer not null,
  needs_tool boolean not null,
  tool_name text,
  tool_input text,
  outcome text not null,
  error_code text,
  error_message text,
  duration_ms integer not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

create index if not exists idx_planner_steps_task_id_step
  on planner_steps(task_id, step);
