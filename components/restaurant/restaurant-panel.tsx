"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ArrowUpRight, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { canAccessWorkspace, formatRoles, workspaces } from "@/lib/restaurant-roles";
import { AuthError } from "@/components/auth/auth-feedback";
import { LinkButton } from "@/components/link-button";
import { Button } from "@/components/ui/button";

export function RestaurantPanel() {
  const registration = useQuery(api.restaurants.current);
  if (registration === undefined) return <p role="status">Cargando tu restaurante…</p>;
  if (registration === null) return <LinkButton href="/crear-cuenta">Volver a mi registro</LinkButton>;
  const { staff, restaurant, location } = registration;
  if (!staff.isActive) return <p role="alert">Tu acceso a este restaurante está desactivado. Habla con el dueño para recuperarlo.</p>;
  const available = workspaces.filter((workspace) => canAccessWorkspace(staff.roles, workspace.value));
  return (
    <div className="restaurant-panel">
      <div>
        <p className="restaurant-eyebrow">{location.name} · {restaurant.currencyCode}</p>
        <h2 className="restaurant-name">{restaurant.name}</h2>
        <p>Hola, {staff.displayName}.</p>
        <div className="staff-roles" aria-label="Tus roles">{formatRoles(staff.roles).map((label) => <span key={label}>{label}</span>)}</div>
      </div>
      {staff.roles.includes("owner") && <OwnerCode />}
      <nav className="workspace-grid" aria-label="Tus áreas de trabajo">
        {available.map((workspace) => (
          <LinkButton className="workspace-link" variant="outline" href={`/cuenta/${workspace.value}`} key={workspace.value}>
            <span><strong>{workspace.label}</strong><small>{workspace.description}</small></span>
            <ArrowUpRight aria-hidden="true" />
          </LinkButton>
        ))}
      </nav>
      <p className="small-note">Estas vistas iniciales muestran los registros disponibles. Las pantallas completas de operación se conectarán en la siguiente etapa. Los pagos en línea aún no están habilitados.</p>
    </div>
  );
}

function OwnerCode() {
  const code = useQuery(api.restaurants.ownerCode);
  const rotate = useMutation(api.restaurants.rotateCode);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    if (pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await rotate();
      setConfirm(false);
      setMessage("Código actualizado. El anterior ya no permite nuevos registros.");
    } catch (cause) {
      setError(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "No pudimos actualizar el código.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="restaurant-code-panel" aria-labelledby="code-title">
      <h3 id="code-title">Código de tu restaurante</h3>
      <p className="small-note">Compártelo solo con tu equipo. Quien tenga el código podrá unirse y elegir sus roles operativos.</p>
      <code className="restaurant-code">{code ?? "Cargando…"}</code>
      <div className="account-actions">
        <Button className="site-button" variant="outline" disabled={!code || pending} onClick={async () => {
          try {
            await navigator.clipboard.writeText(code!);
            setMessage("Código copiado.");
          } catch {
            setMessage("No pudimos copiarlo. Selecciona el código y cópialo manualmente.");
          }
        }}><Copy aria-hidden="true" />Copiar código</Button>
        <Button className="site-button" variant="outline" disabled={pending} onClick={() => setConfirm(!confirm)}><RefreshCw aria-hidden="true" />Cambiar código</Button>
      </div>
      {confirm && <div className="auth-form">
        <p>El código anterior dejará de funcionar. Tu equipo actual conservará su acceso.</p>
        <div className="account-actions">
          <Button className="site-button" disabled={pending} onClick={regenerate}>{pending ? "Actualizando…" : "Confirmar nuevo código"}</Button>
          <Button className="site-button" variant="outline" disabled={pending} onClick={() => setConfirm(false)}>Cancelar</Button>
        </div>
      </div>}
      {message && <p role="status" className="small-note">{message}</p>}
      <AuthError message={error} />
    </section>
  );
}
