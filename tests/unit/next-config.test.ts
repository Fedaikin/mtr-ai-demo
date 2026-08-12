import { describe, expect, it } from "vitest";

import { resolveOutputMode } from "../../next.config";

describe("Next.js deployment output", () => {
  it("keeps standalone output for Docker and on-premise builds", () => {
    expect(resolveOutputMode(false)).toBe("standalone");
  });

  it("lets Vercel build its native serverless output", () => {
    expect(resolveOutputMode(true)).toBeUndefined();
  });
});
