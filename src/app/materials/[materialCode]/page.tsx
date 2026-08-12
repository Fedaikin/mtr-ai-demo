import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  createSapMockAdapter,
  type SapMockAdapter,
  SapMockError,
} from "@/adapters/mock/sap-adapter";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getDemoSession } from "@/lib/session";

export const metadata: Metadata = { title: "Карточка материала SAP" };

export default async function MaterialPage({
  params,
}: {
  params: Promise<{ materialCode: string }>;
}) {
  const [{ materialCode }, adapter, session] = await Promise.all([
    params,
    createSapMockAdapter(),
    getDemoSession(),
  ]);

  let loadError: unknown;
  let loaded: Awaited<ReturnType<typeof loadMaterialData>>;
  try {
    loaded = await loadMaterialData(adapter, materialCode, session.user.id);
  } catch (error) {
    loadError = error;
  }

  if (loadError instanceof SapMockError && loadError.status === 404) notFound();
  if (loadError) {
    return (
      <div>
        <PageHeader eyebrow="SAP S/4HANA" title="Карточка материала" />
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <p className="font-semibold">Остатки SAP недоступны</p>
          <p className="mt-2 leading-6">
            {loadError instanceof SapMockError
              ? loadError.safeMessage
              : "SAP временно недоступен. Повторите запрос позднее."}
          </p>
          <p className="mt-3 text-xs text-amber-800">Для продолжения доступен ручной импорт CSV/Excel.</p>
        </div>
      </div>
    );
  }
  if (!loaded) notFound();
  const { materials, state, material } = loaded;

  return (
      <div>
        <PageHeader
          eyebrow="SAP S/4HANA · демонстрационная карточка"
          title={material.nameRu}
          description={`${material.materialCode} · ${material.equipmentType}`}
          action={
            <Link
              href="/specifications"
              className="focus-ring inline-flex rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              К спецификациям
            </Link>
          }
        />

        {state.state === "STALE" ? (
          <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            Снимок SAP помечен как устаревший. Проверьте дату актуальности перед использованием.
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Характеристики материала</h2>
            <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <Field label="Код SAP" value={material.materialCode} mono />
              <Field label="Legacy-код" value={material.legacyCode ?? "—"} mono />
              <Field label="Английское название" value={material.nameEn ?? "—"} />
              <Field label="Тип оборудования" value={material.equipmentType} />
              <Field label="Стандарт" value={material.standard ?? "—"} mono />
              <Field label="Марка материала" value={material.materialGrade ?? "—"} mono />
            </dl>

            <h3 className="mt-7 text-sm font-semibold text-slate-950">Размеры и параметры</h3>
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(material.dimensions).map(([key, value]) => (
                    <tr key={key}>
                      <th className="w-1/2 bg-slate-50 px-4 py-3 text-left font-medium text-slate-600">{dimensionLabel(key)}</th>
                      <td className="px-4 py-3 text-slate-950">{String(value ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Свободный остаток</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                {formatNumber(materials.reduce((sum, item) => sum + item.availableQuantity, 0))}
                <span className="ml-2 text-base font-medium text-slate-500">{material.unit}</span>
              </p>
              <dl className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm">
                <Field label="Завод" value={material.plant} mono />
                <Field label="Склад" value={material.storageLocation} mono />
                <Field label="Партия" value={material.batch ?? "—"} mono />
                <Field label="Снимок" value={formatDateTime(material.snapshotAt)} />
              </dl>
            </section>
            <p className="rounded-lg border border-teal-100 bg-teal-50 p-3 text-xs leading-5 text-teal-900">
              Карточка и остатки полностью синтетические. Они относятся только к демонстрационному контуру.
            </p>
          </aside>
        </div>
      </div>
  );
}

async function loadMaterialData(adapter: SapMockAdapter, materialCode: string, userId: string) {
  const [materials, state] = await Promise.all([
    adapter.getMaterialStock(materialCode, userId),
    adapter.getState(userId),
  ]);
  const material = materials[0];
  return material ? { materials, state, material } : undefined;
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className={`mt-1 break-words text-sm text-slate-950 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function dimensionLabel(key: string): string {
  const labels: Record<string, string> = {
    nominalDiameterMm: "Номинальный диаметр, мм",
    inletDiameterMm: "Входной диаметр, мм",
    outletDiameterMm: "Выходной диаметр, мм",
    wallThicknessMm: "Толщина стенки, мм",
    pressureClassBar: "Давление, бар",
    angleDeg: "Угол, °",
    voltageV: "Напряжение, В",
    powerKw: "Мощность, кВт",
    crossSectionMm2: "Сечение, мм²",
    flowM3h: "Расход, м³/ч",
    headM: "Напор, м",
  };
  return labels[key] ?? key;
}
