const INTERNAL_TOOL_PATTERN =
  /\b(?:appius|sap|norms?|normative|scenarios?|reports?|llm)\.[a-z][a-z0-9_.-]*\b/iu;
const RAW_JSON_PATTERN = /(?:```\s*json|^\s*[{[]|"(?:toolCalls|systemPrompt|arguments|stackTrace)"\s*:)/iu;
const INTERNAL_REASONING_PATTERN =
  /(?:chain[- ]of[- ]thought|system\s+prompt|внутренн(?:ий|его)\s+промпт|ход\s+рассуждений|stack\s*trace|\bat\s+[\w$.]+\s*\()/iu;

export interface PublicAgentDecision {
  answer: string;
  confidence?: number;
  requiresHumanReview?: boolean;
  technicalContentRemoved: boolean;
}

/** Only the final answer and decision metadata are allowed in the user chat. */
export function toPublicAgentDecision(
  answer: string,
  structuredOutput: Record<string, unknown> | null,
): PublicAgentDecision {
  const technicalContentRemoved = containsInternalAgentContent(answer);
  const confidence = validConfidence(structuredOutput?.confidence);
  const requiresHumanReview =
    typeof structuredOutput?.requiresHumanReview === "boolean"
      ? structuredOutput.requiresHumanReview
      : undefined;

  if (technicalContentRemoved) {
    return {
      answer:
        "Технические сведения ответа скрыты. Повторите вопрос или передайте результат на экспертную проверку.",
      confidence: 0,
      requiresHumanReview: true,
      technicalContentRemoved: true,
    };
  }

  return {
    answer,
    ...(confidence === undefined ? {} : { confidence }),
    ...(requiresHumanReview === undefined ? {} : { requiresHumanReview }),
    technicalContentRemoved: false,
  };
}

export function containsInternalAgentContent(value: string): boolean {
  return (
    INTERNAL_TOOL_PATTERN.test(value) ||
    RAW_JSON_PATTERN.test(value) ||
    INTERNAL_REASONING_PATTERN.test(value)
  );
}

function validConfidence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}
