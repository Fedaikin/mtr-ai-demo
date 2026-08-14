import { describe, expect, it } from "vitest";

import { USER_NAVIGATION } from "@/components/app-shell";

describe("рабочая навигация", () => {
  it("показывает общую аналитику предпоследней, непосредственно перед справкой", () => {
    const itemNames = USER_NAVIGATION.map(({ name }) => name);

    expect(itemNames.slice(-2)).toEqual(["Общая аналитика", "Справка"]);
  });
});
