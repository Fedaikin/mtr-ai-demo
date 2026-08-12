import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getRepository } from "@/adapters/persistence/repository";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, formatNumber } from "@/lib/format";
import { requireDemoRole } from "@/lib/session";

export const metadata: Metadata = { title: "Карточка промышленного каталога" };
export const dynamic = "force-dynamic";

export default async function CatalogItemPage({ params }: { params: Promise<{ code: string }> }) {
  const [{ code }, { user }, repository] = await Promise.all([
    params,
    requireDemoRole("USER"),
    getRepository(),
  ]);
  const normalizedCode = code.trim().toLocaleUpperCase("ru-RU");
  const item = await repository.getCatalogItemByCode(user.id, normalizedCode);
  if (!item) notFound();
  const [substitutes, bom] = await Promise.all([
    repository.listCatalogFamilySubstitutes(user.id, normalizedCode),
    item.itemKind === "ASSEMBLY"
      ? repository.getCatalogAssemblyBom(user.id, normalizedCode)
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow={`Промышленный каталог · ${item.itemKind === "ASSEMBLY" ? "сборочный узел" : "компонент"}`}
        title={item.nameRu}
        description={`${item.itemCode} · ${item.equipmentType}`}
        action={<div className="flex flex-wrap gap-2"><Link href="/catalog" className="focus-ring inline-flex rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">К каталогу</Link><Link href="/agent" className="focus-ring inline-flex rounded-md bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-800">Подобрать через агента</Link></div>}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Характеристики позиции</h2>
            <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <Field label="Код" value={item.itemCode} mono />
              <Field label="Legacy-код" value={item.legacyCode ?? "—"} mono />
              <Field label="Номер производителя" value={item.manufacturerPartNumber ?? "—"} mono />
              <Field label="Производитель" value={item.manufacturer ?? "—"} />
              <Field label="Стандарт" value={item.standard ?? "—"} mono />
              <Field label="Материал / исполнение" value={item.materialGrade ?? "—"} />
              <Field label="Единица измерения" value={item.unit} />
              <Field label="Английское название" value={item.nameEn ?? "—"} />
            </dl>
            <h3 className="mt-7 text-sm font-semibold text-slate-950">Параметры совместимости</h3>
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">{Object.entries(item.characteristics).filter(([key]) => !["category", "compatibilityStatus", "familyCode"].includes(key)).map(([key, value]) => <tr key={key}><th className="w-1/2 bg-slate-50 px-4 py-3 text-left font-medium text-slate-600">{characteristicLabel(key)}</th><td className="px-4 py-3 text-slate-950">{String(value ?? "—")}</td></tr>)}</tbody></table>
            </div>
          </section>

          {substitutes?.family && substitutes.items.length > 0 ? (
            <section className="overflow-hidden rounded-xl border border-teal-200 bg-white shadow-sm">
              <div className="border-b border-teal-100 bg-teal-50 px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Семейство взаимозаменяемости</p><h2 className="mt-1 text-lg font-semibold text-teal-950">{substitutes.family.nameRu}</h2><p className="mt-1 text-sm text-teal-800">Только подтверждённые совместимые позиции; похожие несовместимые варианты исключены.</p></div>
              <div className="divide-y divide-slate-100">{substitutes.items.map((candidate) => <Link key={candidate.id} href={`/catalog/${encodeURIComponent(candidate.itemCode)}`} className="focus-ring grid gap-2 px-5 py-4 hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto]"><div><p className="font-mono text-xs font-semibold text-teal-800">{candidate.itemCode}</p><p className="mt-1 text-sm font-medium text-slate-950">{candidate.nameRu}</p><p className="mt-1 text-xs text-slate-500">{candidate.manufacturer ?? "—"}</p></div><p className="text-sm font-semibold tabular-nums text-slate-950">{formatNumber(candidate.totalAvailableQuantity)} {candidate.unit}<span className="mt-1 block text-right text-xs font-normal text-slate-500">{candidate.balanceCount} склад. запис.</span></p></Link>)}</div>
            </section>
          ) : null}

          {bom ? (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">BOM</p><h2 className="mt-1 text-lg font-semibold">Состав сборочного узла</h2><p className="mt-1 text-sm text-slate-500">{bom.components.length} компонентов</p></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Поз.</th><th className="px-4 py-3">Компонент</th><th className="px-4 py-3 text-right">Нужно</th><th className="px-4 py-3 text-right">Остаток</th><th className="px-4 py-3">Замены</th></tr></thead><tbody className="divide-y divide-slate-100">{bom.components.map((row) => <tr key={row.id}><td className="px-4 py-3 font-mono text-xs">{row.positionNumber}</td><td className="px-4 py-3"><Link href={`/catalog/${encodeURIComponent(row.component.itemCode)}`} className="font-medium text-teal-800 hover:underline">{row.component.itemCode}</Link><p className="mt-1 text-xs text-slate-500">{row.component.nameRu}{row.isCritical ? " · критический" : ""}</p></td><td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.quantity)} {row.unit}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{formatNumber(row.component.totalAvailableQuantity)} {row.component.unit}</td><td className="px-4 py-3 text-xs text-slate-600">{row.alternativeFamily?.nameRu ?? "—"}</td></tr>)}</tbody></table></div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Суммарный свободный остаток</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{formatNumber(item.totalAvailableQuantity)} <span className="text-base font-medium text-slate-500">{item.unit}</span></p>
            <p className="mt-2 text-sm text-slate-500">{item.balanceCount} складских записей · снимок {formatDateTime(item.latestSnapshotAt)}</p>
          </section>
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-base font-semibold">Остатки по складам</h2></div>
            <div className="divide-y divide-slate-100">{item.balances.map((balance) => <div key={balance.id} className="px-5 py-4"><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-xs font-semibold text-slate-700">{balance.plant}</p><p className="mt-1 text-sm text-slate-600">{balance.storageLocation}</p></div><p className="font-semibold tabular-nums text-slate-950">{formatNumber(balance.availableQuantity)} {balance.unit}</p></div><p className="mt-2 text-xs text-slate-400">Партия {balance.batch ?? "—"} · {formatDateTime(balance.snapshotAt)}</p></div>)}</div>
          </section>
          <p className="rounded-lg border border-teal-100 bg-teal-50 p-3 text-xs leading-5 text-teal-900">Все позиции, производители и остатки синтетические. Каталог предназначен только для демонстрации поиска и подбора замен.</p>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className={`mt-1 break-words text-sm text-slate-950 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd></div>;
}

function characteristicLabel(key: string): string {
  const labels: Record<string, string> = {
    nominalDiameterMm: "Номинальный диаметр, мм", pressureClassBar: "Класс давления, бар", connectionCode: "Тип присоединения", schedule: "Толщина / Schedule", standardCode: "Код стандарта", rangeMin: "Нижняя граница диапазона", rangeMax: "Верхняя граница диапазона", outputSignal: "Выходной сигнал", processConnection: "Процессное присоединение", accuracyClass: "Класс точности", ratedVoltageV: "Номинальное напряжение, В", ratedCurrentA: "Номинальный ток, А", ingressProtection: "Степень защиты", shaftDiameterMm: "Диаметр вала, мм", ratedPowerKw: "Мощность, кВт", speedRpm: "Частота вращения, об/мин", nominalSizeMm: "Номинальный размер, мм", serviceClass: "Класс применения", temperatureMaxC: "Максимальная температура, °C",
  };
  return labels[key] ?? key;
}
