// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InfoHint } from "@/components/info-hint";

afterEach(cleanup);

describe("context help interaction", () => {
  it("opens explanatory text and closes without submitting its enclosing form", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={submit}><InfoHint title="Общий остаток" /></form>);
    fireEvent.click(screen.getByRole("button", { name: "Пояснение: Общий остаток" }));
    expect(await screen.findByRole("dialog", { name: "Общий остаток" })).toBeTruthy();
    expect(screen.getByText(/Сумма доступных количеств в демонстрационном каталоге/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть пояснение" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(submit).not.toHaveBeenCalled();
  });

  it("opens from the keyboard and dismisses with Escape", async () => {
    render(<InfoHint title="Сборочные узлы" />);
    const trigger = screen.getByRole("button", { name: "Пояснение: Сборочные узлы" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    // Native button activation is synthesized by the browser, not by jsdom.
    fireEvent.click(trigger, { detail: 0 });
    const dialog = await screen.findByRole("dialog", { name: "Сборочные узлы" });
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
