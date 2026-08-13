import { describe, expect, it } from "vitest";

import { resolveActiveNavigationHref } from "@/lib/navigation";

describe("resolveActiveNavigationHref", () => {
  it.each([
    ["/agent", "/mtr-analysis"],
    ["/mtr-analysis", "/mtr-analysis"],
    ["/catalog", "/catalog"],
    ["/catalog/CAT-DEMO-PIP-0005", "/catalog"],
    ["/materials/SAP-DEMO-0001", "/mtr-analysis"],
    ["/reports/run-demo", "/mtr-analysis"],
    ["/specifications/spec-demo", "/specifications"],
    ["/runs/run-demo", "/admin/scenarios"],
    ["/modeling", "/admin/scenarios"],
    ["/admin/scenarios", "/admin/scenarios"],
    ["/pulse", "/pulse"],
  ])("marks the expected section for %s", (pathname, expected) => {
    expect(resolveActiveNavigationHref(pathname)).toBe(expected);
  });
});
