vi.mock("server-only", () => ({}));

import { NextResponse } from "next/server";

import { POST as logout } from "@/app/api/auth/logout/route";
import { loginInputSchema, safeReturnPath } from "@/lib/auth-input";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth-cookie";
import { SESSION_COOKIE_NAME } from "@/lib/auth-config";
import { assertSameOrigin } from "@/lib/csrf";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("demo authentication primitives", () => {
  it("stores passwords as salted scrypt hashes and compares them safely", async () => {
    const first = await hashPassword("MtrLocalTestOnly!");
    const second = await hashPassword("MtrLocalTestOnly!");

    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toContain("MtrLocalTestOnly!");
    expect(first).not.toBe(second);
    await expect(verifyPassword("MtrLocalTestOnly!", first)).resolves.toBe(true);
    await expect(verifyPassword("wrong", first)).resolves.toBe(false);
    await expect(verifyPassword("Demo2026!", "malformed")).resolves.toBe(false);
  });

  it("rejects user_id spoofing and unsafe return paths", () => {
    expect(() =>
      loginInputSchema.parse({ login: "demo", password: "MtrLocalTestOnly!", user_id: "victim" }),
    ).toThrow();
    expect(safeReturnPath("/reports/run-1?tab=agent")).toBe("/reports/run-1?tab=agent");
    expect(safeReturnPath("https://attacker.example")).toBe("/");
    expect(safeReturnPath("//attacker.example")).toBe("/");
    expect(safeReturnPath("/%5C%5Cattacker.example")).toBe("/");
    expect(safeReturnPath("/%255C%255Cattacker.example")).toBe("/");
    expect(safeReturnPath("/%2F%2Fattacker.example")).toBe("/");
    expect(safeReturnPath("/%2e%2e//attacker.example")).toBe("/");
    expect(safeReturnPath("/%252e%252e//attacker.example")).toBe("/");
    expect(safeReturnPath("/\\attacker.example")).toBe("/");
    expect(safeReturnPath("/login?next=/admin")).toBe("/");
  });

  it("sets a persistent HttpOnly SameSite cookie and clears it explicitly", () => {
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, "a".repeat(43), new Date(Date.now() + 60_000).toISOString());
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=43200");

    clearSessionCookie(response);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects cross-origin mutation requests", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://mtr.example/api/auth/login", {
          method: "POST",
          headers: { host: "mtr.example", origin: "https://attacker.example" },
        }),
      ),
    ).toThrowError(/Источник запроса/);
    expect(() =>
      assertSameOrigin(
        new Request("https://mtr.example/api/auth/login", {
          method: "POST",
          headers: { host: "mtr.example", origin: "https://mtr.example" },
        }),
      ),
    ).not.toThrow();
  });

  it("returns a safe 403 response for a cross-origin logout", async () => {
    const response = await logout(
      new Request("https://mtr.example/api/auth/logout", {
        method: "POST",
        headers: { host: "mtr.example", origin: "https://attacker.example" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_ORIGIN",
        message: "Источник запроса не разрешён.",
        details: null,
      },
    });
  });
});
