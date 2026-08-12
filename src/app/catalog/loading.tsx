export default function CatalogLoading() {
  return (
    <div aria-busy="true" aria-label="Загрузка промышленного каталога" className="space-y-4">
      <div className="h-28 animate-pulse rounded-xl bg-slate-200" />
      <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
      <div className="h-[420px] animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
