"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { Authenticated, AuthLoading, Unauthenticated, usePreloadedQuery, type Preloaded } from "convex/react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { LinkButton } from "@/components/link-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RestaurantPanel } from "@/components/restaurant/restaurant-panel";
import { AuthError } from "./auth-feedback";

export function AccountPanel({ preloaded }: { preloaded: Preloaded<typeof api.users.current> }) {
  const user = usePreloadedQuery(preloaded);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setPending(true);
    setError(null);
    try {
      await signOut();
      router.replace("/acceso");
      router.refresh();
    } catch {
      setPending(false);
      setError("No pudimos cerrar tu sesión. Vuelve a intentar.");
    }
  }

  return (
    <>
      <AuthLoading><p role="status">Cargando tu cuenta…</p></AuthLoading>
      <Unauthenticated>
        <p>Tu sesión terminó. Vuelve a iniciar sesión para continuar.</p>
        <LinkButton href="/acceso">Iniciar sesión</LinkButton>
      </Unauthenticated>
      <Authenticated>
        {user ? (
          <Card className="account-card">
            <CardHeader>
              <CardTitle>Tu restaurante</CardTitle>
              <CardDescription>Cambia de área sin cambiar de cuenta.</CardDescription>
            </CardHeader>
            <CardContent>
              <RestaurantPanel />
              <AuthError message={error} />
              <div className="account-actions">
                <LinkButton href="/" variant="outline">Conocer la plataforma</LinkButton>
                <Button className="site-button" variant="secondary" disabled={pending} onClick={logout}><LogOut aria-hidden="true" />{pending ? "Cerrando sesión…" : "Cerrar sesión"}</Button>
              </div>
            </CardContent>
          </Card>
        ) : <p role="alert">No pudimos encontrar tu perfil de usuario.</p>}
      </Authenticated>
    </>
  );
}
