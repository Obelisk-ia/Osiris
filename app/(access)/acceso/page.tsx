import type { Metadata } from "next";
import { AccessForm } from "@/components/auth/access-form";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default function SignInPage() {
  return (
    <AuthShell title="Bienvenido" emphasis="de vuelta" description="Inicia sesión con tu correo y tu contraseña.">
      <AccessForm mode="login" />
    </AuthShell>
  );
}
