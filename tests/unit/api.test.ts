vi.mock("server-only", () => ({}));

import { toErrorResponse } from "@/lib/api";

describe("API error boundary", () => {
  it("logs only a request id and a safe error category", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitiveMessage = "database password=should-never-reach-logs";

    const response = toErrorResponse(new TypeError(sensitiveMessage));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Не удалось выполнить операцию. Повторите попытку.",
    });
    expect(payload.error.requestId).toEqual(expect.any(String));
    expect(log).toHaveBeenCalledWith("Unhandled API error", {
      requestId: payload.error.requestId,
      errorType: "TYPE_ERROR",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(sensitiveMessage);

    log.mockRestore();
  });
});
