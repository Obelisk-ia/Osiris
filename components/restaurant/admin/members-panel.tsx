"use client";

import { useMutation, usePreloadedQuery, useQuery, type Preloaded } from "convex/react";
import { Copy, Info, RefreshCw, Shield, Users } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  formatRoles,
  isRoleSelectionChecked,
  roleSelections,
  toggleRoleSelection,
  type OperationalRole,
  type StaffRole,
} from "@/lib/restaurant-roles";
import { errorMessage, initials } from "@/lib/format";
import { AdminModal, AdminPageHead, ConfirmModal, EmptyState, ToastBanner, useToast } from "./admin-ui";

type Member = Doc<"staff">;

export function MembersPanel({ preloaded }: { preloaded: Preloaded<typeof api.admin.membersSnapshot> }) {
  const data = usePreloadedQuery(preloaded);
  const ownerCode = useQuery(api.restaurants.ownerCode, data.isOwner ? {} : "skip");
  const rotateCode = useMutation(api.restaurants.rotateCode);
  const updateMemberRoles = useMutation(api.admin.updateMemberRoles);
  const toggleMemberActive = useMutation(api.admin.toggleMemberActive);
  const { toast, showToast } = useToast();

  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Member | null>(null);
  const [togglePending, setTogglePending] = useState(false);

  async function handleRotate() {
    setRotating(true);
    try {
      await rotateCode();
      setConfirmRotate(false);
      showToast("Código actualizado. El anterior ya no permite registros.");
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos actualizar el código."), "err");
    } finally {
      setRotating(false);
    }
  }

  async function handleToggleMember() {
    if (!toggleTarget) return;
    setTogglePending(true);
    try {
      await toggleMemberActive({ memberId: toggleTarget._id });
      showToast(toggleTarget.isActive ? `${toggleTarget.displayName} desactivado` : `${toggleTarget.displayName} reactivado`);
      setToggleTarget(null);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos actualizar el estado."), "err");
    } finally {
      setTogglePending(false);
    }
  }

  return (
    <div className="az-page narrow">
      <AdminPageHead
        index={7}
        total={8}
        restaurantName={data.restaurantName}
        locationName={data.locationName}
        title="Miembros"
        subtitle="Desactivar a alguien impide su acceso inmediato, pero conserva su historial y sus registros."
      />

      {data.isOwner ? (
        <section className="az-card" aria-labelledby="invite-code-heading">
          <div>
            <h2 id="invite-code-heading" className="font-heading text-lg font-bold">
              Código de invitación de {data.restaurantName}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Compártelo solo con tu equipo. Al crear su cuenta podrán unirse a esta sucursal y elegir sus roles
              operativos.
            </p>
          </div>
          <code className="restaurant-code">{ownerCode ?? "Cargando…"}</code>
          <div className="az-row-actions">
            <Button
              variant="outline"
              disabled={!ownerCode}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(ownerCode!);
                  showToast("Código copiado");
                } catch {
                  showToast("No pudimos copiar el código.", "err");
                }
              }}
            >
              <Copy className="size-4" aria-hidden="true" />
              Copiar código
            </Button>
            <Button variant="outline" onClick={() => setConfirmRotate(true)}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Cambiar código
            </Button>
          </div>
        </section>
      ) : (
        <div className="az-notice">
          <Info className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Estás viendo el directorio de tu equipo como gerente. Solo el <strong>dueño</strong> puede cambiar roles,
            desactivar miembros o regenerar el código de invitación.
          </span>
        </div>
      )}

      {data.members.length > 0 ? (
        <ul className="az-rows">
          {data.members.map((member) => {
            const isSelf = member._id === data.currentStaffId;
            return (
              <li key={member._id}>
                <div className="az-row-main">
                  <span className="az-avatar" aria-hidden="true">
                    {initials(member.displayName)}
                  </span>
                  <div className="az-row-text">
                    <div className="az-cluster">
                      <strong>{member.displayName}</strong>
                      {isSelf && <span className="az-badge accent">Tú</span>}
                      {!member.isActive && <span className="az-badge">Desactivado</span>}
                    </div>
                    <div className="az-cluster mt-1">
                      {formatRoles(member.roles as StaffRole[]).map((label) => (
                        <span key={label} className="az-badge">
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  {data.isOwner && !isSelf && (
                    <div className="az-row-actions">
                      <Button variant="outline" size="sm" onClick={() => setEditingMember(member)}>
                        <Shield className="size-3.5" aria-hidden="true" />
                        Roles
                      </Button>
                      <Button
                        variant={member.isActive ? "destructive" : "outline"}
                        size="sm"
                        onClick={() => setToggleTarget(member)}
                      >
                        {member.isActive ? "Desactivar" : "Reactivar"}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={<Users className="size-7" aria-hidden="true" />}
          title="Sin miembros"
          description="Comparte el código de invitación con tu equipo para que se unan."
        />
      )}

      {editingMember && (
        <RolesModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSave={async (roles) => {
            await updateMemberRoles({ memberId: editingMember._id, roles });
            showToast(`Roles de ${editingMember.displayName} actualizados`);
            setEditingMember(null);
          }}
        />
      )}

      {toggleTarget && (
        <ConfirmModal
          title={toggleTarget.isActive ? `Desactivar a ${toggleTarget.displayName}` : `Reactivar a ${toggleTarget.displayName}`}
          message={
            toggleTarget.isActive
              ? "Ya no podrá entrar al restaurante y se liberará cualquier sección que tenga asignada. Su historial se conserva."
              : "Podrá volver a entrar con sus roles actuales."
          }
          confirmLabel={toggleTarget.isActive ? "Desactivar" : "Reactivar"}
          danger={toggleTarget.isActive}
          pending={togglePending}
          onConfirm={() => void handleToggleMember()}
          onClose={() => setToggleTarget(null)}
        />
      )}

      {confirmRotate && (
        <ConfirmModal
          title="Cambiar código de invitación"
          message="El código anterior dejará de funcionar para nuevos registros. Tu equipo actual conservará su acceso."
          confirmLabel="Confirmar nuevo código"
          danger
          pending={rotating}
          onConfirm={() => void handleRotate()}
          onClose={() => setConfirmRotate(false)}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}

function RolesModal({
  member,
  onClose,
  onSave,
}: {
  member: Member;
  onClose: () => void;
  onSave: (roles: StaffRole[]) => Promise<void>;
}) {
  const [isManager, setIsManager] = useState(member.roles.includes("manager"));
  const [opRoles, setOpRoles] = useState<OperationalRole[]>(
    () => member.roles.filter((r): r is OperationalRole => r !== "owner" && r !== "manager"),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setError(null);
    const next: StaffRole[] = [...(isManager ? (["manager"] as const) : []), ...opRoles];
    if (next.length === 0) {
      setError("Elige al menos un rol para esta persona.");
      return;
    }
    setPending(true);
    try {
      await onSave(next);
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos actualizar los roles."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={`Roles de ${member.displayName}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" className="site-button" disabled={pending} onClick={() => void save()}>
            {pending ? "Guardando…" : "Guardar roles"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Combina los permisos que necesite. El rol de gerente da acceso al panel completo de administración (excepto
          gestión de miembros).
        </p>

        <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 cursor-pointer">
          <input
            type="checkbox"
            className="size-4 mt-1 accent-[#15140f]"
            checked={isManager}
            onChange={(e) => setIsManager(e.target.checked)}
          />
          <span className="grid gap-0.5">
            <strong className="text-sm">Gerente</strong>
            <span className="text-xs text-muted-foreground">
              Menú, inventario, plano de mesas, buffet, códigos QR y configuración.
            </span>
          </span>
        </label>

        {roleSelections.map((selection) => {
          const checked = isRoleSelectionChecked(opRoles, selection);
          return (
            <label
              key={selection.value}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 cursor-pointer"
            >
              <input
                type="checkbox"
                className="size-4 mt-1 accent-[#15140f]"
                checked={checked}
                onChange={(e) => setOpRoles((prev) => toggleRoleSelection(prev, selection, e.target.checked))}
              />
              <span className="grid gap-0.5">
                <strong className="text-sm">{selection.label}</strong>
                {selection.hint && <span className="text-xs text-muted-foreground">{selection.hint}</span>}
              </span>
            </label>
          );
        })}

        {error && <p className="floor-error" role="alert">{error}</p>}
      </div>
    </AdminModal>
  );
}
