"use client";

import { useActionState } from "react";
import Link from "next/link";
import { activarAction, type ActivarState } from "./actions";
import { Button, Input, Label } from "@/components/ui";

const initial: ActivarState = {};

export function ActivarForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(activarAction, initial);

  if (state.ok) {
    return (
      <div className="text-center">
        <p className="text-sm font-medium text-slate-900">Tu cuenta quedó activada.</p>
        <p className="mt-1 text-sm text-slate-500">
          Ya puedes ingresar con tu correo y la contraseña que acabas de definir.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Ir a ingresar
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <Label htmlFor="password">Crea tu contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Al menos 8 caracteres"
        />
      </div>
      <div>
        <Label htmlFor="confirmacion">Repite la contraseña</Label>
        <Input
          id="confirmacion"
          name="confirmacion"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="••••••••"
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Activando…" : "Activar mi cuenta"}
      </Button>
    </form>
  );
}
