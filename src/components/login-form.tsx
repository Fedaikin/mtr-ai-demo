"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <label className="block space-y-1.5 text-sm font-medium text-slate-800">
        <span>Логин</span>
        <Input name="login" autoComplete="username" required maxLength={64} autoFocus />
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
