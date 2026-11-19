import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { AccessForm } from "@/components/auth/access-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { convexAuthNextjsAccessToken, isAuthenticatedNextjs } from "@/lib/convex-auth";

export const metadata: Metadata = { title: "Crear cuenta" };

async function SignUpContent() {
  if (await isAuthenticatedNextjs()) {
    const token = await convexAuthNextjsAccessToken();
    const user = await fetchQuery(api.users.current, {}, { token: token ?? undefined });
    if (user?.staffId) redirect("/cuenta");
  }
  return <AccessForm mode="signup" />;
}

export default function SignUpPage() {
  return (
    <AuthShell title="Crea tu" emphasis="cuenta" description="Elige cómo te unes, completa tus datos y entra directamente a tu panel." label="Crear cuenta">
      <Suspense fallback={<p role="status">Cargando registro…</p>}><SignUpContent /></Suspense>
    </AuthShell>
  );
}
