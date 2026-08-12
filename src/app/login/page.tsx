import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { safeReturnPath } from "@/lib/auth-input";
import { getOptionalDemoSession } from "@/lib/session";

export const metadata: Metadata = { title: "Вход" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const [{ next }, session] = await Promise.all([searchParams, getOptionalDemoSession()]);
  const returnTo = safeReturnPath(typeof next === "string" ? next : undefined);
  if (session) redirect(returnTo);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7f6] px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <section className="p-6 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Демо-система</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Вход в анализ МТР</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Введите выданные владельцем прототипа реквизиты доступа.
          </p>
          <div className="mt-8"><LoginForm returnTo={returnTo} /></div>
          <p className="mt-6 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500">
            Нет реквизитов? Обратитесь к владельцу прототипа.
          </p>
        </section>
      </div>
    </main>
  );
}
