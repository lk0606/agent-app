-- E.9：单次任务的聚合观测（耗时 / token / 估算成本）。
-- 关联键是 taskId，不是 OpenTelemetry traceId；决策细节仍看 planner_steps / plannerTrace。
create table if not exists task_metrics (
  task_id text primary key references tasks(id) on delete cascade,
  duration_ms integer not null,
  llm_call_count integer not null default 0,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  tool_call_count integer not null default 0,
  planner_step_count integer not null default 0,
  -- 学习用估算价（USD）；单价来自 env，非账单真相
  estimated_cost_usd numeric(14, 8),
  -- 每次 plan / answer / summarize 的明细，便于对照「哪次 LLM 最贵」
  llm_calls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
