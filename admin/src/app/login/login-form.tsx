"use client";

import { useActionState } from "react";
import { loginAction, type ActionState } from "@/lib/actions";

type Labels = { email: string; password: string; submit: string; login: string; notAdmin: string };

export function LoginForm({ labels }: { labels: Labels }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(loginAction, {});
  const field = "h-12 w-full rounded-2xl border border-edge bg-surface px-4 outline-none focus:border-lilac";
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-semibold">
        {labels.email}
        <input name="email" type="email" autoComplete="email" required className={`mt-1.5 ${field}`} />
      </label>
      <label className="block text-sm font-semibold">
        {labels.password}
        <input name="password" type="password" autoComplete="current-password" required className={`mt-1.5 ${field}`} />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-coral-text">
          {state.error === "notAdmin" ? labels.notAdmin : labels.login}
        </p>
      )}
      <button disabled={pending} className="h-12 w-full rounded-full bg-coral font-semibold text-ink disabled:opacity-60">
        {labels.submit}
      </button>
    </form>
  );
}
