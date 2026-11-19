"use client";

import { useSignUpWithUsernamePassword } from "@convex-dev/auth/methods/username-password/react";
import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { ConvexHttpClient } from "convex/browser";
import { useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { authErrorMessage } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RegistrationFields, type RegistrationDetails } from "@/components/restaurant/registration-fields";
import { AuthError } from "./auth-feedback";
import { PasswordInput } from "./password-input";

export function SignUpForm() {
  const { signUp } = useSignUpWithUsernamePassword(api.auth);
  const { signOut } = useAuthActions();
  const token = useAuthToken();
  const { isLoading } = useConvexAuth();
  const router = useRouter();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<RegistrationDetails>({
    kind: "owner", displayName: "", restaurantName: "", code: "", roles: [],
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || isLoading) return;
    setError(null);
    if (!details.displayName.trim() || (details.kind === "owner" && !details.restaurantName.trim())) {
      setError("Completa tu nombre y los datos del restaurante.");
      return;
    }
    if (details.kind === "staff" && details.roles.length === 0) {
      setError("Elige al menos un rol para continuar.");
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      let accessToken = token;
      if (accessToken === null) {
        const result = await signUp({ username: email.trim(), password });
        if (result.status !== "complete") {
          setError(authErrorMessage(result.userError));
          return;
        }
        accessToken = result.tokens.accessToken;
        setPassword("");
      }
      // Use the freshly minted access token directly. The reactive client's
      // WebSocket authentication may not have completed immediately after signup.
      const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
      client.setAuth(accessToken);
      const result = await client.mutation(api.restaurants.completeRegistration, {
        registration: details.kind === "owner"
          ? { kind: "owner", displayName: details.displayName, restaurantName: details.restaurantName }
          : { kind: "staff", displayName: details.displayName, code: details.code, roles: details.roles },
      });
      if (!result.success) {
        setError(result.message);
        return;
      }
      router.replace("/cuenta");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ConvexError && typeof cause.data === "string"
        ? cause.data : "No pudimos completar tu registro. Tus datos siguen aquí; vuelve a intentar.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function switchAccount() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await signOut();
      setPassword("");
    } catch {
      setError("No pudimos cerrar tu sesión. Vuelve a intentar.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} aria-busy={pending}>
      <RegistrationFields value={details} onChange={setDetails} disabled={pending} />
      {token === null ? (
        <>
          <div className="auth-field">
            <Label htmlFor="signup-email">Correo</Label>
            <Input id="signup-email" name="email" type="email" autoComplete="username" maxLength={100} placeholder="tu@correo.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} required />
          </div>
          <PasswordInput id="signup-password" value={password} onChange={setPassword} disabled={pending} newPassword />
          <p className="small-note">Sin correos de verificación. Guarda tu contraseña: no hay recuperación por correo.</p>
        </>
      ) : (
        <p className="small-note">Tu sesión está iniciada. Guarda los datos de tu restaurante para entrar directamente al panel.</p>
      )}
      <AuthError message={error} />
      <Button type="submit" className="site-button auth-submit" disabled={pending || isLoading}>
        {pending ? <><LoaderCircle className="animate-spin" aria-hidden="true" />Guardando registro…</> : <>{token ? "Guardar y entrar al panel" : "Crear cuenta"} <ArrowUpRight aria-hidden="true" /></>}
      </Button>
      {token !== null && <Button type="button" variant="ghost" disabled={pending} onClick={switchAccount}>Usar otra cuenta</Button>}
    </form>
  );
}
