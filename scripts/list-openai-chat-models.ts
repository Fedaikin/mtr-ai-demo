import OpenAI from "openai";

import { OpenAIResponsesPlanner, readOpenAIResponsesPlannerConfig } from "@/application/agent-orchestrator/universal-chat/live-planner";

const config = readOpenAIResponsesPlannerConfig();
if (!config) {
  throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required in the server environment");
}

const planner = new OpenAIResponsesPlanner(config, new OpenAI({
  apiKey: config.apiKey,
  maxRetries: 0,
  timeout: config.timeoutMs,
}) as never);
const models = await planner.listAvailableModels();
const chatCandidates = models.filter((id) =>
  /^(?:gpt-5|gpt-4\.1|o[34](?:-|$))/u.test(id) &&
  !/(?:codex|realtime|audio|image|search|transcribe|tts)/iu.test(id));

console.log(JSON.stringify({
  configuredModel: config.model,
  configuredModelAvailable: models.includes(config.model),
  candidateModelIds: chatCandidates,
}, null, 2));
