import Link from "next/link";

export default function ForbiddenPage() {
  return <main className="mx-auto flex min-h-screen max-w-xl items-center px-6"><section className="w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><p className="text-sm font-semibold uppercase text-rose-700">403 · Доступ ограничен</p><h1 className="mt-3 text-2xl font-semibold">Недостаточно полномочий</h1><p className="mt-3 text-sm text-slate-600">Запрошенное действие не входит в активную роль. Изменение роли немедленно отзывает текущую сессию.</p><Link href="/" className="mt-6 inline-flex rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white">На главную</Link></section></main>;
}
