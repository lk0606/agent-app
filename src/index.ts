import { PlannerAgent } from "./agents/planner-agent.js";
import { loadConfig } from "./config/env.js";
import { InMemoryStore } from "./memory/in-memory-store.js";
import { TaskRunner } from "./runtime/task-runner.js";
import { createLogger } from "./shared/logger.js";
import { EchoTool } from "./tools/echo-tool.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.appName);
  const memory = new InMemoryStore();
  const tools = [new EchoTool()];
  const agent = new PlannerAgent();
  const runner = new TaskRunner({ agent, tools, memory, logger });

  const result = await runner.run({
    taskId: "demo-task",
    input: "请帮我确认这个 Agent 脚手架是否已经具备最小可运行闭环。",
  });

  logger.info("Final result", result);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
