import type { AgentExecutionContext } from "@/domain/agent/context";
import type {
  UniversalCapabilityInput,
  UniversalCapabilityRemoteExecutor,
  UniversalReadCapabilityKey,
} from "@/application/agent-orchestrator/universal-chat/capability-registry";

const WITNESS_GATEWAY_URL = "http://http-proxy:4310/__fastgate/witness";
const MAX_RESPONSE_BYTES = 5_000_000;

type FastGateEnvironment = Readonly<Record<string, string | undefined>>;

export function createFastGateUniversalCapabilityClient(
  environment: FastGateEnvironment = process.env,
  fetchImpl: typeof fetch = fetch,
): UniversalCapabilityRemoteExecutor {
  if (environment.FASTGATE_OFFICIAL !== "1") {
    throw new Error("FASTGATE_WITNESS_CLIENT_DISABLED");
  }
  const origin = validateWitnessOrigin(environment.FASTGATE_WITNESS_URL);

  return {
    async execute<K extends UniversalReadCapabilityKey>(
      capabilityKey: K,
      context: AgentExecutionContext,
      input: UniversalCapabilityInput<K>,
    ): Promise<unknown> {
      const response = await fetchImpl(`${origin}/v1/capability`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-request-id": context.correlationId,
        },
        body: JSON.stringify({
          capabilityKey,
          input,
          context: {
            subjectId: context.trusted.subjectId,
            activeProjectId: context.trusted.activeProjectId,
            authorizationVersion: context.trusted.authorizationVersion,
            correlationId: context.correlationId,
          },
        }),
      });
      if (!response.ok) throw new Error("FASTGATE_WITNESS_REQUEST_FAILED");
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw new Error("FASTGATE_WITNESS_RESPONSE_TOO_LARGE");
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
        throw new Error("FASTGATE_WITNESS_RESPONSE_TOO_LARGE");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("FASTGATE_WITNESS_RESPONSE_INVALID");
      }
      if (!payload || typeof payload !== "object" || !("output" in payload)) {
        throw new Error("FASTGATE_WITNESS_RESPONSE_INVALID");
      }
      return (payload as { output: unknown }).output;
    },
  };
}

function validateWitnessOrigin(value: string | undefined): string {
  if (!value) throw new Error("FASTGATE_WITNESS_URL_FORBIDDEN");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("FASTGATE_WITNESS_URL_FORBIDDEN");
  }
  if (
    `${url.origin}${url.pathname}` !== WITNESS_GATEWAY_URL
    || url.search !== ""
    || url.hash !== ""
    || url.username !== ""
    || url.password !== ""
  ) {
    throw new Error("FASTGATE_WITNESS_URL_FORBIDDEN");
  }
  return WITNESS_GATEWAY_URL;
}
