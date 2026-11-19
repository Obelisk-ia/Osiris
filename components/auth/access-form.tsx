"use client";

import { useSignInWithUsernamePassword } from "@convex-dev/auth/methods/username-password/react";
import { useConvexAuth } from "convex/react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { authErrorMessage } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuthError } from "./auth-feedback";
import { PasswordInput } from "./password-input";
import { SignUpForm } from "./signup-form";

export function AccessForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  return (
    <>
      <Tabs value={mode} onValueChange={(value) => router.replace(value === "signup" ? "/crear-cuenta" : "/acceso", { scroll: false })} className="auth-tabs">
        <TabsList aria-label="Acceso a Osiris">
          <TabsTrigger value="login">Iniciar sesión</TabsTrigger>
          <TabsTrigger value="signup">Crear cuenta</TabsTrigger>
        </TabsList>
        <TabsContent value="login"><LoginForm /></TabsContent>
        <TabsContent value="signup"><SignUpForm /></TabsContent>
      </Tabs>
    </>
  );
}

function EmailInput({ value, onChange, disabled, id }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  id: string;
}) {
  return (
    <div className="auth-field">
      <Label htmlFor={id}>Correo</Label>
      <Input id={id} name="email" type="email" autoComplete="username" maxLength={100} placeholder="tu@correo.com" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required />
    </div>
  );
}

function LoginForm() {
  const { signIn, pending } = useSignInWithUsernamePassword(api.auth);
  const { isLoading } = useConvexAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (pending) return;
    const result = await signIn({ username: email.trim(), password });
    if (result.status === "complete") {
      router.replace("/cuenta");
      router.refresh();
      return;
    }
    setError(authErrorMessage(result.userError));
  }

  return (
    <form className="auth-form" onSubmit={submit} aria-busy={pending}>
      <EmailInput id="email" value={email} onChange={setEmail} disabled={pending} />
      <PasswordInput value={password} onChange={setPassword} disabled={pending} />
      <div className="auth-row">
        <span className="small-note">Tu sesión se guarda de forma segura.</span>
      </div>
      <AuthError message={error} />
      <Button type="submit" className="site-button auth-submit" disabled={pending || isLoading}>
        {pending ? <><LoaderCircle className="animate-spin" aria-hidden="true" />Entrando…</> : <>Iniciar sesión <ArrowUpRight aria-hidden="true" /></>}
      </Button>
    </form>
  );
}
