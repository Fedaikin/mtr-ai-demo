import { redactSensitiveData, redactSensitiveRecord, safeAuditPreview } from "@/lib/redaction";

describe("central audit redaction", () => {
  it("removes nested credentials, cookies and raw document content", () => {
    const value = redactSensitiveRecord({
      promptVersion: "mtr-agent-v7",
      arguments: {
        materialCode: "SAP-DEMO-0001",
        password: "Demo2026!",
        nested: [{ authorization: "Bearer hidden-token" }],
      },
      documentText: "полный конфиденциальный документ",
      result: { count: 3 },
    });

    expect(value).toEqual({
      promptVersion: "mtr-agent-v7",
      arguments: {
        materialCode: "SAP-DEMO-0001",
        password: "[СКРЫТО]",
        nested: [{ authorization: "[СКРЫТО]" }],
      },
      documentText: "[СКРЫТО]",
      result: { count: 3 },
    });
  });

  it("scrubs credentials embedded in otherwise safe strings and limits previews", () => {
    const credentialUrl = ["https://demo:unsafe", "example.test/path"].join("@");
    const redacted = redactSensitiveData({
      safeMessage: `request Bearer abcdefghijklmnop password=unsafe ${credentialUrl}`,
    });
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(serialized).not.toContain("password=unsafe");
    expect(serialized).not.toContain("demo:unsafe");
    expect(safeAuditPreview({ text: "x".repeat(1_000) }, 80)).toHaveLength(80);
  });

  it("omits absent object fields instead of persisting an undefined sentinel", () => {
    expect(
      redactSensitiveRecord({
        runId: undefined,
        result: { state: "AVAILABLE", count: undefined },
      }),
    ).toEqual({ result: { state: "AVAILABLE" } });
  });
});
