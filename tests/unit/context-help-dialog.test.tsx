// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InfoHint } from "@/components/info-hint";

afterEach(cleanup);

describe("context help interaction", () => {
  it("opens a non-modal explanation and toggles it without submitting its enclosing form", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={submit}><InfoHint title="Общий остаток" /></form>);
    const trigger = screen.getByRole("button", { name: "Пояснение: Общий остаток" });
    fireEvent.click(trigger);
    const popup = await screen.findByRole("dialog", { name: "Общий остаток" });
    expect(popup.getAttribute("aria-modal")).not.toBe("true");
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(screen.getByText(/Сумма доступных количеств в демонстрационном каталоге/)).toBeTruthy();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(submit).not.toHaveBeenCalled();
  });

  it("dismisses on an outside click without blocking the outside control", async () => {
    const outsideAction = vi.fn();
    render(<><InfoHint title="Общий остаток" /><button onClick={outsideAction}>Вне подсказки</button></>);
    fireEvent.click(screen.getByRole("button", { name: "Пояснение: Общий остаток" }));
    await screen.findByRole("dialog", { name: "Общий остаток" });
    const outside = screen.getByRole("button", { name: "Вне подсказки" });
    fireEvent.mouseDown(outside);
    fireEvent.mouseUp(outside);
    fireEvent.click(outside);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(outsideAction).toHaveBeenCalledOnce();
  });

  it("shows only the newly selected explanation and keeps its text readable", async () => {
    render(<><InfoHint title="Общий остаток" /><InfoHint title="Сборочные узлы" /></>);
    fireEvent.click(screen.getByRole("button", { name: "Пояснение: Общий остаток" }));
    await screen.findByRole("dialog", { name: "Общий остаток" });
    const nextTrigger = screen.getByRole("button", { name: "Пояснение: Сборочные узлы" });
    fireEvent.mouseDown(nextTrigger);
    fireEvent.mouseUp(nextTrigger);
    fireEvent.click(nextTrigger);
    const popup = await screen.findByRole("dialog", { name: "Сборочные узлы" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Общий остаток" })).toBeNull());
    fireEvent.mouseDown(popup);
    fireEvent.click(popup);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
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
