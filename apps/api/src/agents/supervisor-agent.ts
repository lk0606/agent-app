/**
 * E.12 SupervisorAgent：多 Agent 编排入口（分诊，不自己执行业务工具）。
 *
 * 常规执行顺序（跨模块）：
 * 1. TaskRunner.run → agent.plan（本类）
 * 2. llm.routeSpecialty → 选 docs | files | general
 * 3. recordPlannerStep(outcome=routed, toolName=专家 id) 占 step 1
 * 4. PlannerAgent.plan(tools=该专家子集, stepOffset=1) → 写后续 planner_steps / tool_calls
 * 5. 返回专家的 AgentResponse 给 TaskRunner 收尾
 * 旁路：取消/超时透传 signal；路由失败抛 LLM_ERROR；不确定专家应落 general（由路由实现保证）
 *
 * 本文件执行链路：见方法上的 [1]…[3]
 * [1] plan → [2] routeSpecialty + 落库 routed → [3] 委托 PlannerAgent
 *
 * 本版不做 A→B 热转接（误路由靠保守 general + 后续 E.12.x handoff）。
 */
import type { SpecialistId } from "../llm/llm-client.js";
import { throwIfAborted } from "../runtime/abort-utils.js";
import { AppError } from "../shared/app-error.js";
import type { Tool } from "../tools/tool.js";
import type { Agent, AgentContext, AgentRequest, AgentResponse } from "./base-agent.js";
import type { PlannerAgent } from "./planner-agent.js";

export type SpecialistCatalog = Record<SpecialistId, Tool[]>;

const SPECIALIST_DESCRIPTIONS: Record<SpecialistId, string> = {
  docs: "Document search and Q&A over sandbox docs (search_docs, read_file, list_dir). Not for writing files.",
  files: "Sandbox file operations: list_dir, read_file, write_file. Prefer when user wants to write/create/save files.",
  general:
    "Catch-all with all tools (time, http_fetch, echo, wait, and file/docs tools). Use when unsure or for time/URL/wait.",
};

export class SupervisorAgent implements Agent {
  constructor(
    private readonly options: {
      planner: PlannerAgent;
      /** 专家 id → 可调用的 Tool 实例（general 应为全量） */
      specialists: SpecialistCatalog;
    },
  ) {}

  /** [1] 入口：路由一次后委托专家 Planner；与单 Planner 同为 TaskRunner 的 agent.plan */
  async plan(request: AgentRequest, context: AgentContext): Promise<AgentResponse> {
    throwIfAborted(context.signal);56

    const routeStartedAt = Date.now();
    const routeCreatedAt = new Date(routeStartedAt).toISOString();

    // [2] 分诊：只选专家，不执行业务工具
    const specialistId = await context.llm.routeSpecialty({
      userInput: request.input,
      specialists: (Object.keys(this.options.specialists) as SpecialistId[]).map((id) => ({
        id,
        description: SPECIALIST_DESCRIPTIONS[id],
      })),
      signal: context.signal,
      onLlmCall: (event) => context.metrics?.recordLlmCall(event),
    });

    throwIfAborted(context.signal);

    const tools = this.options.specialists[specialistId];
    // 装配错误：catalog 缺键或空列表 → 内部错误，不是模型路由问题
    if (!tools || tools.length === 0) {
      throw new AppError(
        "INTERNAL_ERROR",
        `Supervisor has no tools registered for specialist "${specialistId}".`,
      );
    }

    context.logger.info("Supervisor routed to specialist", {
      specialistId,
      toolNames: tools.map((tool) => tool.name),
    });

    context.emitStream?.({
      type: "planner_decision",
      taskId: request.taskId,
      step: 1,
      needsTool: false,
      toolName: specialistId,
      toolInput: null,
    });

    // step 1 = 路由决策；toolName 复用列存专家 id（非真实工具名）
    // 合法例：outcome=routed, toolName=docs；非法例：把 search_docs 写进这一步（那是专家后续 step）
    await context.memory.recordPlannerStep({
      taskId: request.taskId,
      step: 1,
      needsTool: false,
      toolName: specialistId,
      toolInput: null,
      outcome: "routed",
      durationMs: Date.now() - routeStartedAt,
      createdAt: routeCreatedAt,
      finishedAt: new Date().toISOString(),
    });

    // [3] 专家跑完整 plan 循环；stepOffset=1 让专家从 step 2 起落库
    return this.options.planner.plan(request, {
      ...context,
      tools,
      stepOffset: 1,
    });
  }
}
