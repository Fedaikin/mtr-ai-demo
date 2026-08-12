import { describe, expect, it } from "vitest";

import { resolveActiveNavigationHref } from "@/lib/navigation";

describe("resolveActiveNavigationHref", () => {
  it.each([
    ["/agent", "/agent"],
    ["/agent?run=run-demo", "/agent"],
    ["/catalog", "/catalog"],
    ["/catalog/CAT-DEMO-PIP-0005", "/catalog"],
    ["/materials/SAP-DEMO-0001", "/agent"],
    ["/reports/run-demo", "/agent"],
    ["/specifications/spec-demo", "/specifications"],
    ["/runs/run-demo", "/runs"],
  ])("marks the expected section for %s", (pathname, expected) => {
    expect(resolveActiveNavigationHref(pathname)).toBe(expected);
  });
});
