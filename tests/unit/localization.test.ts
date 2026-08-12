import { describe, expect, it } from "vitest";

import {
  analysisStatusLabel,
  analogueVerdictLabel,
  ENUM_LABELS,
  findRawUserEnums,
  integrationStatusLabel,
  localizeKnownEnum,
  localizeKnownEnumsInText,
  matchCategoryLabel,
  responsibilityLabel,
  runStatusLabel,
} from "@/lib/localization";

describe("единый словарь локализации", () => {
  it("содержит обязательные русские соответствия", () => {
    expect(runStatusLabel("QUEUED")).toBe("В очереди");
    expect(runStatusLabel("LOADING_APPIUS")).toBe("Загрузка данных из Appius PLM");
    expect(runStatusLabel("SYNCING_SAP")).toBe("Синхронизация с SAP S/4HANA");
    expect(runStatusLabel("CLASSIFYING_RESPONSIBILITY")).toBe("Определение ответственности");
    expect(runStatusLabel("MATCHING_STOCK")).toBe("Поиск на складе");
    expect(runStatusLabel("FINDING_ANALOGUES")).toBe("Поиск аналогов");
    expect(runStatusLabel("GENERATING_REPORT")).toBe("Формирование отчёта");
    expect(runStatusLabel("COMPLETED")).toBe("Завершено");
    expect(runStatusLabel("FAILED")).toBe("Ошибка");
    expect(runStatusLabel("CANCELLED")).toBe("Отменено");

    expect(integrationStatusLabel("AVAILABLE")).toBe("Доступно");
    expect(integrationStatusLabel("UNAVAILABLE")).toBe("Недоступно");
    expect(integrationStatusLabel("SLOW")).toBe("Замедленная работа");
    expect(integrationStatusLabel("STALE")).toBe("Данные устарели");
    expect(integrationStatusLabel("RATE_LIMITED")).toBe("Превышен лимит запросов");

    expect(responsibilityLabel("CUSTOMER")).toBe("Заказчик");
    expect(responsibilityLabel("CONTRACTOR")).toBe("Подрядчик");
    expect(matchCategoryLabel("EXACT")).toBe("Точное совпадение");
    expect(matchCategoryLabel("LIKELY")).toBe("Вероятное совпадение");
    expect(matchCategoryLabel("REVIEW")).toBe("Требуется проверка");
    expect(matchCategoryLabel("NO_MATCH")).toBe("Не найдено");
    expect(analogueVerdictLabel("SUITABLE")).toBe("Подходит");
    expect(analogueVerdictLabel("REVIEW")).toBe("Требуется экспертная проверка");
    expect(analogueVerdictLabel("NOT_RECOMMENDED")).toBe("Не рекомендуется");
    expect(analysisStatusLabel("ANALOGUES")).toBe("Покрыто аналогами");
  });

  it("локализует известные значения и сохраняет технические аббревиатуры", () => {
    expect(localizeKnownEnum("AVAILABLE")).toBe("Доступно");
    expect(localizeKnownEnum("SAP")).toBe("SAP");
    expect(localizeKnownEnum("RAG")).toBe("RAG");
    expect(localizeKnownEnum("HTTP")).toBe("HTTP");
    expect(localizeKnownEnumsInText("Тип PIPE отличается от FITTING; SAP доступен")).toBe(
      "Тип Труба отличается от Фитинг; SAP доступен",
    );
    expect(localizeKnownEnum("ALLOCATED")).toBe("Аналог распределён");
    expect(localizeKnownEnum("NO_APPLICABLE_RULE")).toBe("Нет применимого нормативного правила");
    expect(localizeKnownEnum("NO_ELIGIBLE_CANDIDATE")).toBe("Допустимый аналог не найден");
    expect(
      localizeKnownEnumsInText(
        "Результаты: ALLOCATED, NO_APPLICABLE_RULE, NO_ELIGIBLE_CANDIDATE.",
      ),
    ).toBe(
      "Результаты: Аналог распределён, Нет применимого нормативного правила, Допустимый аналог не найден.",
    );
  });

  it("находит необработанные enum как отдельные значения", () => {
    expect(findRawUserEnums("Статусы: QUEUED, AVAILABLE и NO_MATCH.")).toEqual([
      "QUEUED",
      "AVAILABLE",
      "NO_MATCH",
    ]);
    expect(findRawUserEnums("SAP / RAG / API доступны")).toEqual([]);
  });

  it("не оставляет английское значение в словарях", () => {
    for (const dictionary of Object.values(ENUM_LABELS)) {
      for (const [raw, label] of Object.entries(dictionary)) {
        expect(label, raw).not.toBe(raw);
        expect(findRawUserEnums(label), raw).toEqual([]);
      }
    }
  });
});
