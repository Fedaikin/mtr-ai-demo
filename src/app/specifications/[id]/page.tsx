import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  type AppiusMockAdapter,
  AppiusMockError,
  createAppiusMockAdapter,
} from "@/adapters/mock/appius-adapter";
import { PageHeader } from "@/components/page-header";
import type { Position } from "@/domain/models";
import { normalizeText } from "@/domain/normalize";
import { formatDateTime, formatNumber } from "@/lib/format";
import { equipmentTypeLabel, specificationVersionStatusLabel } from "@/lib/localization";
import { getDemoSession } from "@/lib/session";

export const metadata: Metadata = { title: "Спецификация" };

interface SpecificationSearchParams {
  version?: string | string[];
  history?: string | string[];
  q?: string | string[];
  type?: string | string[];
}

export default async function SpecificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SpecificationSearchParams>;
}) {
  const [{ id }, query, adapter, session] = await Promise.all([
    params,
    searchParams,
    createAppiusMockAdapter(),
    getDemoSession(),
  ]);

  let loadError: unknown;
  let loaded: Awaited<ReturnType<typeof loadSpecificationData>>;
  try {
    loaded = await loadSpecificationData(adapter, session.user.id, id, query);
  } catch (error) {
    loadError = error;
  }

  if (loadError instanceof AppiusMockError && loadError.status === 404) notFound();
  if (loadError) {
    return (
      <div>
        <PageHeader eyebrow="Appius PLM" title="Спецификация" />
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <p className="font-semibold">Не удалось открыть данные спецификации</p>
          <p className="mt-2 leading-6">
            {loadError instanceof AppiusMockError
              ? loadError.safeMessage
              : "Appius временно недоступен. Повторите запрос позднее."}
          </p>
        </div>
      </div>
    );
  }
  if (!loaded) notFound();
  const {
    specification,
    versions,
    selectedVersion,
    history,
    positions,
    textQuery,
    equipmentType,
    filteredPositions,
    equipmentTypes,
  } = loaded;

  return (
      <div>
        <PageHeader
          eyebrow={`${specification.projectCode} · Appius PLM`}
          title={specification.name}
          description={`Версия ${selectedVersion.versionNumber} · ${selectedVersion.isCurrent ? "актуальная для анализа" : "исторический просмотр"}`}
          action={
            <Link
              href="/specifications"
              className="focus-ring inline-flex rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Все спецификации
            </Link>
          }
        />

        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Metric label="Версия" value={`v${selectedVersion.versionNumber}`} detail={specificationVersionStatusLabel(selectedVersion.status)} />
          <Metric label="Дата действия" value={formatDateTime(selectedVersion.effectiveAt)} detail="Часовой пояс: Москва" />
          <Metric label="Позиции" value={formatNumber(selectedVersion.positionCount)} detail="в метаданных версии" />
        </div>

        {selectedVersion.sourceFileName ? <section className="mb-5 rounded-xl border border-teal-200 bg-teal-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Источник версии</p><div className="mt-2 grid gap-2 text-sm sm:grid-cols-3"><p><span className="text-slate-500">Файл:</span> {selectedVersion.sourceFileId ? <a className="font-medium text-teal-800 underline underline-offset-2" href={`/api/uploads/${selectedVersion.sourceFileId}`}>{selectedVersion.sourceFileName}</a> : selectedVersion.sourceFileName}</p><p><span className="text-slate-500">Формат:</span> {selectedVersion.sourceKind ?? "—"}</p><p><span className="text-slate-500">Опубликован:</span> {selectedVersion.publishedAt ? formatDateTime(selectedVersion.publishedAt) : "—"}</p></div>{selectedVersion.validationSummary ? <p className="mt-2 text-xs text-slate-600">Проверка импорта: {String(selectedVersion.validationSummary.validRows ?? selectedVersion.positionCount)} валидных строк · {String(selectedVersion.validationSummary.warningCount ?? 0)} предупреждений.</p> : null}</section> : null}

        <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-950">Версии Appius</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {versions.map((version) => (
              <Link
                key={version.id}
                href={
                  version.isCurrent
                    ? `/specifications/${id}?version=${version.id}`
                    : `/specifications/${id}?version=${version.id}&history=1`
                }
                className={`focus-ring rounded-md border px-3 py-2 text-xs font-medium ${
                  version.id === selectedVersion.id
                    ? "border-teal-300 bg-teal-50 text-teal-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                v{version.versionNumber} · {version.isCurrent ? "актуальная" : "архив"}
              </Link>
            ))}
          </div>
        </section>

        {!selectedVersion.isCurrent ? (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Режим просмотра истории</p>
            <p className="mt-1 leading-6">
              Архивная версия не может быть выбрана для нового анализа. Её позиции и метаданные источника сохранены для воспроизводимости старых запусков.
            </p>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <form className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[1fr_220px_auto]">
            <input type="hidden" name="version" value={selectedVersion.id} />
            {history ? <input type="hidden" name="history" value="1" /> : null}
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Поиск по позиции
              <input
                name="q"
                defaultValue={textQuery}
                placeholder="Код, название, стандарт"
                className="focus-ring h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 placeholder:text-slate-400"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Тип оборудования
              <select
                name="type"
                defaultValue={equipmentType}
                className="focus-ring h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950"
              >
                <option value="">Все типы</option>
                {equipmentTypes.map((type) => <option key={type} value={type}>{equipmentTypeLabel(type)}</option>)}
              </select>
            </label>
            <button
              type="submit"
              className="focus-ring self-end rounded-md bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800"
            >
              Применить
            </button>
          </form>

          <div className="data-table-scroll overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Код</th>
                  <th className="px-4 py-3">Наименование</th>
                  <th className="px-4 py-3">Тип</th>
                  <th className="px-4 py-3">Стандарт / марка</th>
                  <th className="px-4 py-3 text-right">Требуется</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPositions.map((position) => (
                  <tr key={position.id} className="align-top hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">
                      {position.internalCode}
                      <span className="mt-1 block text-slate-400">{position.id}</span>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-slate-950">{position.nameRu}</p>
                      {position.nameEn ? <p className="mt-1 text-xs text-slate-500">{position.nameEn}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-xs font-medium text-slate-700">
                      {equipmentTypeLabel(position.equipmentType)}
                    </td>
                    <td className="px-4 py-4 text-xs leading-5 text-slate-600">
                      <span className="block">{position.standard ?? "—"}</span>
                      <span className="block text-slate-400">{position.materialGrade ?? "—"}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-right font-medium text-slate-950">
                      {formatNumber(position.requiredQuantity)} {position.unit}
                    </td>
                  </tr>
                ))}
                {filteredPositions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                      {positions.length === 0
                        ? "Для этой версии позиции не входят в базовый набор данных."
                        : "По заданным фильтрам позиции не найдены."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
  );
}

async function loadSpecificationData(
  adapter: AppiusMockAdapter,
  userId: string,
  id: string,
  query: SpecificationSearchParams,
) {
  const specifications = await adapter.listSpecifications(userId);
  const specification = specifications.find((item) => item.id === id);
  if (!specification) return undefined;

  const versions = await adapter.listVersions(id, userId);
  const requestedVersionId = first(query.version);
  const selectedVersion = requestedVersionId
    ? versions.find((version) => version.id === requestedVersionId)
    : versions.find((version) => version.isCurrent);
  if (!selectedVersion) return undefined;

  const history = selectedVersion.isCurrent ? false : first(query.history) === "1";
  const positions = await adapter.getPositions(id, selectedVersion.id, userId, { history });
  const textQuery = first(query.q)?.trim() ?? "";
  const equipmentType = first(query.type)?.trim() ?? "";
  return {
    specification,
    versions,
    selectedVersion,
    history,
    positions,
    textQuery,
    equipmentType,
    filteredPositions: filterPositions(positions, textQuery, equipmentType),
    equipmentTypes: [...new Set(positions.map((position) => position.equipmentType))].sort(),
  };
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}

function filterPositions(positions: Position[], textQuery: string, equipmentType: string): Position[] {
  const needle = normalizeText(textQuery);
  return positions.filter((position) => {
    if (equipmentType && position.equipmentType !== equipmentType) return false;
    if (!needle) return true;
    const searchable = normalizeText(
      [
        position.internalCode,
        position.nameRu,
        position.nameEn,
        position.standard,
        position.materialGrade,
        ...position.synonyms,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return searchable.includes(needle);
  });
}

function first(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
