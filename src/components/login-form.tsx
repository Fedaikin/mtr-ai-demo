"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEMO_PERSONAS } from "@/domain/demo-personas";

export function LoginForm({ returnTo, showPersonaSelector = false }: { returnTo: string; showPersonaSelector?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: form.get("login"),
          password: form.get("password"),
        }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось войти в систему.");
      router.replace(returnTo);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось войти в систему.");
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {showPersonaSelector ? <label className="block space-y-1.5 text-sm font-medium text-slate-800"><span>Демо-персона</span><select value={login} onChange={(event) => setLogin(event.target.value)} className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Выберите роль…</option>{DEMO_PERSONAS.map((persona) => <option key={persona.login} value={persona.login}>{persona.label}</option>)}</select></label> : null}
      <label className="block space-y-1.5 text-sm font-medium text-slate-800">
        <span>Логин</span>
        <Input name="login" value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" required maxLength={64} autoFocus />
      </label>
      <label className="block space-y-1.5 text-sm font-medium text-slate-800">
        <span>Пароль</span>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
        />
      </label>
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
      <Button className="w-full" type="submit" disabled={pending}>
        {pending ? "Входим…" : "Войти"}
      </Button>
    </form>
  );
}
