import type { Metadata } from "next";
import Link from "next/link";

import { getRepository } from "@/adapters/persistence/repository";
import { PageHeader } from "@/components/page-header";
import { CATALOGUE_CATEGORIES, type CatalogueCategory, type CatalogueItemKind } from "@/domain/catalogue";
import { formatDateTime, formatNumber } from "@/lib/format";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Промышленный каталог" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [parameters, session, repository] = await Promise.all([
    searchParams,
    requirePermission("catalog.read"),
    getRepository(),
  ]);
  const { user } = session;
  const canReadStock = session.authorization.permissionKeys.has("stock.search");
  const query = first(parameters.q)?.trim().slice(0, 240) ?? "";
  const category = catalogCategory(first(parameters.category));
  const itemKind = catalogItemKind(first(parameters.itemKind));
  const page = positiveInteger(first(parameters.page), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const [result, overview] = await Promise.all([
    repository.searchCatalogItems(user.id, {
      ...(query ? { text: query } : {}),
      ...(category ? { category } : {}),
      ...(itemKind ? { itemKind } : {}),
      limit: PAGE_SIZE,
      offset,
    }),
    repository.getCatalogOverview(user.id),
  ]);
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        eyebrow="Промышленный каталог · синтетические данные"
        title="Номенклатура и складские остатки"
        description={`${formatNumber(overview.items)} позиций и ${formatNumber(overview.families)} семейств взаимозаменяемости${canReadStock ? `, ${formatNumber(overview.stockBalanceRows)} складских записей` : ""}.`}
        action={
          <Link href="/agent" className="focus-ring inline-flex rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800">
            Спросить МТР-аналитика
          </Link>
        }
      />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <form className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px_190px_auto]" method="get">
          <label className="block text-sm font-medium text-slate-700">
            Поиск по коду, названию, производителю
            <input name="q" defaultValue={query} placeholder="Например, насос или CAT-DEMO-ROT" className="focus-ring mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Категория
            <select name="category" defaultValue={category ?? ""} className="focus-ring mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">Все категории</option>
              {CATALOGUE_CATEGORIES.map((value) => <option key={value} value={value}>{categoryLabel(value)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Вид позиции
            <select name="itemKind" defaultValue={itemKind ?? ""} className="focus-ring mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">Компоненты и узлы</option>
              <option value="COMPONENT">Компоненты</option>
              <option value="ASSEMBLY">Сборочные узлы</option>
            </select>
          </label>
          <button type="submit" className="focus-ring self-end rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Найти</button>
        </form>
      </section>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <p>Найдено: <span className="font-semibold text-slate-950">{formatNumber(result.total)}</span>. Показано {result.items.length}.</p>
        <p>Страница {page} из {pageCount}</p>
      </div>

      <section className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Код</th><th className="px-4 py-3">Позиция</th><th className="px-4 py-3">Категория / тип</th><th className="px-4 py-3">Производитель</th><th className="px-4 py-3 text-right">Остаток</th><th className="px-4 py-3 text-right">Склады</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 align-top"><Link href={`/catalog/${encodeURIComponent(item.itemCode)}`} className="font-mono text-xs font-semibold text-teal-800 hover:underline">{item.itemCode}</Link><p className="mt-1 text-[11px] text-slate-400">{item.itemKind === "ASSEMBLY" ? "Узел" : "Компонент"}</p></td>
                  <td className="max-w-[360px] px-4 py-3 align-top"><Link href={`/catalog/${encodeURIComponent(item.itemCode)}`} className="font-medium text-slate-950 hover:text-teal-800">{item.nameRu}</Link><p className="mt-1 text-xs text-slate-500">{item.standard ?? "Без стандарта"} · {item.materialGrade ?? "марка не указана"}</p></td>
                  <td className="px-4 py-3 align-top text-slate-700">{item.category ? categoryLabel(item.category) : "—"}<p className="mt-1 font-mono text-[11px] text-slate-400">{item.equipmentType}</p></td>
                  <td className="px-4 py-3 align-top text-slate-700">{item.manufacturer ?? "—"}</td>
                  <td className="px-4 py-3 text-right align-top font-semibold tabular-nums text-slate-950">{canReadStock ? <>{formatNumber(item.totalAvailableQuantity)} <span className="font-normal text-slate-500">{item.unit}</span><p className="mt-1 text-[11px] font-normal text-slate-400">{formatDateTime(item.latestSnapshotAt)}</p></> : <span className="text-xs font-normal text-slate-400">Нет доступа</span>}</td>
                  <td className="px-4 py-3 text-right align-top tabular-nums text-slate-700">{canReadStock ? item.balanceCount : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.items.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">По заданным условиям позиции не найдены.</p> : null}
      </section>

      <nav aria-label="Пагинация каталога" className="mt-4 flex items-center justify-between gap-3">
        {page > 1 ? <Link href={catalogHref({ query, category, itemKind, page: page - 1 })} className="focus-ring rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">← Предыдущая</Link> : <span />}
        {offset + result.items.length < result.total ? <Link href={catalogHref({ query, category, itemKind, page: page + 1 })} className="focus-ring rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Следующая →</Link> : <span />}
      </nav>
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/u.test(value)) return fallback;
  return Math.max(1, Math.min(100_000, Number(value)));
}

function catalogCategory(value: string | undefined): CatalogueCategory | undefined {
  return CATALOGUE_CATEGORIES.find((candidate) => candidate === value);
}

function catalogItemKind(value: string | undefined): CatalogueItemKind | undefined {
  return value === "COMPONENT" || value === "ASSEMBLY" ? value : undefined;
}

function catalogHref(input: { query: string; category?: CatalogueCategory; itemKind?: CatalogueItemKind; page: number }): string {
  const parameters = new URLSearchParams();
  if (input.query) parameters.set("q", input.query);
  if (input.category) parameters.set("category", input.category);
  if (input.itemKind) parameters.set("itemKind", input.itemKind);
  if (input.page > 1) parameters.set("page", String(input.page));
  const suffix = parameters.toString();
  return suffix ? `/catalog?${suffix}` : "/catalog";
}

function categoryLabel(value: CatalogueCategory): string {
  const labels: Record<CatalogueCategory, string> = {
    PIPING: "Трубопроводы",
    VALVES: "Арматура",
    INSTRUMENTATION: "КИПиА",
    ELECTRICAL: "Электрика",
    ROTATING: "Вращающееся оборудование",
    MRO: "ТОиР и расходные материалы",
  };
  return labels[value];
}
