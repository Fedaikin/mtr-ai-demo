export default function ApplicationLoading() {
  return (
    <div className="space-y-5" role="status" aria-live="polite" aria-label="Загрузка раздела">
      <span className="sr-only">Загружаю данные…</span>
      <div className="h-5 w-36 animate-pulse rounded bg-slate-200" />
      <div className="h-10 w-full max-w-xl animate-pulse rounded-lg bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm" />
    </div>
  );
}
