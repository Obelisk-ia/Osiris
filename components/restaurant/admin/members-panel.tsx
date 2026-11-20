"use client";

import { useMutation, usePreloadedQuery, useQuery, type Preloaded } from "convex/react";
import { ArrowRightLeft, Copy, Info, RefreshCw, Shield, Users } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  formatRoles,
  isRoleSelectionChecked,
  managerPermissionLabels,
  managerPermissionOptions,
  roleSelections,
  toggleRoleSelection,
  type ManagerPermission,
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
  const transferMemberBranch = useMutation(api.admin.transferMemberBranch);
  const toggleMemberActive = useMutation(api.admin.toggleMemberActive);
  const { toast, showToast } = useToast();

  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);
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
            Estás viendo el directorio de tu equipo como gerente.{" "}
            {data.canTransferStaff
              ? "Tienes permiso del dueño para transferir personal a otra sucursal. Solo el dueño puede cambiar roles, desactivar miembros o regenerar el código."
              : "Solo el dueño puede cambiar roles, transferir personal de sucursal, desactivar miembros o regenerar el código de invitación."}
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
                      {(member.managerPermissions ?? []).map((perm) => (
                        <span key={perm} className="az-badge accent">
                          {managerPermissionLabels[perm]}
                        </span>
                      ))}
                    </div>
                  </div>
                  {!isSelf && (data.isOwner || (data.canTransferStaff && data.branches.length > 1 && !member.roles.includes("owner"))) && (
                    <div className="az-row-actions">
                      {data.canTransferStaff && data.branches.length > 1 && !member.roles.includes("owner") && (
                        <Button variant="outline" size="sm" onClick={() => setTransferTarget(member)}>
                          <ArrowRightLeft className="size-3.5" aria-hidden="true" />
                          Sucursal
                        </Button>
                      )}
                      {data.isOwner && (
                        <>
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
                        </>
                      )}
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
          onSave={async (roles, managerPermissions) => {
            await updateMemberRoles({ memberId: editingMember._id, roles, managerPermissions });
            showToast(`Roles de ${editingMember.displayName} actualizados`);
            setEditingMember(null);
          }}
        />
      )}

      {transferTarget && (
        <TransferBranchModal
          member={transferTarget}
          currentLocationId={data.currentLocationId}
          branches={data.branches}
          onClose={() => setTransferTarget(null)}
          onTransfer={async (targetLocationId) => {
            const target = data.branches.find((b) => b._id === targetLocationId);
            await transferMemberBranch({ memberId: transferTarget._id, targetLocationId });
            showToast(`${transferTarget.displayName} movido a ${target?.name ?? "otra sucursal"}`);
            setTransferTarget(null);
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
  onSave: (roles: StaffRole[], managerPermissions: ManagerPermission[]) => Promise<void>;
}) {
  const [isManager, setIsManager] = useState(member.roles.includes("manager"));
  const [managerPermissions, setManagerPermissions] = useState<ManagerPermission[]>(
    () => (member.managerPermissions ?? []) as ManagerPermission[],
  );
  const [opRoles, setOpRoles] = useState<OperationalRole[]>(
    () => member.roles.filter((r): r is OperationalRole => r !== "owner" && r !== "manager"),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function togglePermission(perm: ManagerPermission, checked: boolean) {
    setManagerPermissions((prev) =>
      checked ? [...new Set([...prev, perm])] : prev.filter((p) => p !== perm),
    );
  }

  async function save() {
    setError(null);
    const next: StaffRole[] = [...(isManager ? (["manager"] as const) : []), ...opRoles];
    if (next.length === 0) {
      setError("Elige al menos un rol para esta persona.");
      return;
    }
    setPending(true);
    try {
      await onSave(next, isManager ? managerPermissions : []);
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
          Combina los permisos que necesite. El rol de gerente da acceso al panel de su sucursal; puedes otorgarle
          permisos especiales abajo.
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
              Inventario local, disponibilidad del menú, plano de mesas, buffet, códigos QR y configuración de su
              sucursal.
            </span>
          </span>
        </label>

        {isManager && (
          <div className="grid gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold text-muted-foreground">
              Permisos especiales del dueño para este gerente
            </p>
            {managerPermissionOptions.map((opt) => (
              <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="size-4 mt-0.5 accent-[#15140f]"
                  checked={managerPermissions.includes(opt.value)}
                  onChange={(e) => togglePermission(opt.value, e.target.checked)}
                />
                <span className="grid gap-0.5">
                  <strong className="text-sm">{opt.label}</strong>
                  <span className="text-xs text-muted-foreground">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        )}

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

function TransferBranchModal({
  member,
  currentLocationId,
  branches,
  onClose,
  onTransfer,
}: {
  member: Member;
  currentLocationId: Id<"locations">;
  branches: ReadonlyArray<{ _id: Id<"locations">; name: string }>;
  onClose: () => void;
  onTransfer: (targetLocationId: Id<"locations">) => Promise<void>;
}) {
  const options = branches.filter((branch) => branch._id !== currentLocationId);
  const [targetId, setTargetId] = useState<string>(options[0]?._id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!targetId) {
      setError("Elige la sucursal de destino.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onTransfer(targetId as Id<"locations">);
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos cambiar de sucursal."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={`Cambiar sucursal de ${member.displayName}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" className="site-button" disabled={pending || !targetId} onClick={() => void submit()}>
            {pending ? "Moviendo…" : "Confirmar cambio"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Al mover a {member.displayName} a otra sucursal se liberarán las mesas o secciones que tenga asignadas aquí y
          solo verá la operación de la nueva sucursal.
        </p>
        <div className="az-field">
          <label htmlFor="transfer-branch-select">Sucursal de destino</label>
          <select
            id="transfer-branch-select"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            {options.map((branch) => (
              <option key={branch._id} value={branch._id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="floor-error" role="alert">{error}</p>}
      </div>
    </AdminModal>
  );
}
