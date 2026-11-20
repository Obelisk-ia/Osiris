"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { AlertTriangle, Building2, Check, ChefHat, Edit3, Grid2x2, Plus, Trash2, Users, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { errorMessage, TIMEZONES, timezoneLabel } from "@/lib/format";
import { AdminModal, AdminPageHead, ConfirmModal, EmptyState, ToastBanner, useToast } from "./admin-ui";

type Branch = Doc<"locations">;

export function BranchesPanel({ preloaded }: { preloaded: Preloaded<typeof api.admin.branchesSnapshot> }) {
  const data = usePreloadedQuery(preloaded);
  const router = useRouter();
  const { toast, showToast } = useToast();

  const createBranch = useMutation(api.admin.createBranch);
  const updateBranch = useMutation(api.admin.updateBranch);
  const switchBranch = useMutation(api.admin.switchBranch);
  const removeBranch = useMutation(api.admin.removeBranch);

  const [modal, setModal] = useState<{ open: true; branch?: Branch } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const currentBranch = data.branches.find((b) => b._id === data.currentLocationId);
  const statusMap = new Map(data.branchStatuses.map((s) => [s.locationId, s] as const));

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      await removeBranch({ locationId: deleteTarget._id });
      showToast("Sucursal eliminada");
      setDeleteTarget(null);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos quitar la sucursal."), "err");
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="az-page narrow">
      <AdminPageHead
        index={8}
        total={8}
        restaurantName={data.restaurantName}
        locationName={currentBranch?.name ?? "Sucursal principal"}
        title="Sucursales"
        subtitle={`Las sucursales de ${data.restaurantName}. Elige con cuál trabajar para ver su plano, existencias y configuración.`}
        actions={
          <Button className="site-button" onClick={() => setModal({ open: true })}>
            <Plus className="size-4" aria-hidden="true" />
            Agregar sucursal
          </Button>
        }
      />

      {data.branches.length > 0 ? (
        <ul className="az-rows">
          {data.branches.map((branch) => {
            const isCurrent = branch._id === data.currentLocationId;
            const status = statusMap.get(branch._id);
            return (
              <li key={branch._id}>
                <div className="az-row-main">
                  <div className="az-row-text">
                    <div className="az-cluster">
                      <strong className="text-[15px]">{branch.name}</strong>
                      {isCurrent && (
                        <span className="az-badge accent">
                          <Check aria-hidden="true" />
                          En uso
                        </span>
                      )}
                      {status && (
                        <span className={`az-badge ${status.hasOpenShift ? "accent" : ""}`}>
                          <Wallet aria-hidden="true" />
                          {status.hasOpenShift ? "Caja abierta" : "Caja cerrada"}
                        </span>
                      )}
                    </div>
                    {branch.address && <p className="text-sm text-muted-foreground">{branch.address}</p>}
                    <p className="text-xs text-muted-foreground">
                      {timezoneLabel(branch.timeZone)} · {data.currencyCode}
                    </p>
                    {status && (
                      <div className="az-cluster mt-2">
                        <span className="az-badge">
                          <Grid2x2 aria-hidden="true" />
                          Mesas {status.occupiedTables}/{status.totalTables}
                        </span>
                        <span className="az-badge">
                          <Users aria-hidden="true" />
                          {status.activeStaffCount} {status.activeStaffCount === 1 ? "empleado" : "empleados"}
                        </span>
                        {status.openAccounts > 0 && (
                          <span className="az-badge">
                            {status.openAccounts} {status.openAccounts === 1 ? "cuenta abierta" : "cuentas abiertas"}
                          </span>
                        )}
                        {status.awaitingPayment > 0 && (
                          <span className="az-badge warn">
                            {status.awaitingPayment} por cobrar
                          </span>
                        )}
                        {status.pendingTickets > 0 && (
                          <span className="az-badge">
                            <ChefHat aria-hidden="true" />
                            {status.pendingTickets} en cocina
                          </span>
                        )}
                        {status.lowStockCount > 0 && (
                          <span className="az-badge danger">
                            <AlertTriangle aria-hidden="true" />
                            {status.lowStockCount} insumo{status.lowStockCount === 1 ? "" : "s"} bajo mínimo
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="az-row-actions">
                    {!isCurrent && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await switchBranch({ locationId: branch._id });
                            showToast(`Ahora trabajas en ${branch.name}`);
                            router.refresh();
                          } catch (cause) {
                            showToast(errorMessage(cause), "err");
                          }
                        }}
                      >
                        Usar
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Editar ${branch.name}`}
                      onClick={() => setModal({ open: true, branch })}
                    >
                      <Edit3 aria-hidden="true" />
                    </Button>
                    {!isCurrent && (
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Quitar ${branch.name}`}
                        onClick={() => setDeleteTarget(branch)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={<Building2 className="size-7" aria-hidden="true" />}
          title="Sin sucursales"
          description="Agrega tu primera sucursal para comenzar."
        />
      )}

      {modal && (
        <BranchModal
          branch={modal.branch}
          restaurantName={data.restaurantName}
          defaultTimeZone={currentBranch?.timeZone ?? "America/Mexico_City"}
          onClose={() => setModal(null)}
          onSave={async (payload) => {
            if (modal.branch) {
              await updateBranch({ locationId: modal.branch._id, ...payload });
              showToast("Sucursal actualizada");
            } else {
              await createBranch({
                name: payload.name,
                address: payload.address,
                timeZone: payload.timeZone,
              });
              showToast(`${payload.name} agregada`);
            }
            setModal(null);
            router.refresh();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Quitar ${deleteTarget.name}`}
          message="Se quitará esta sucursal de tu restaurante. Solo se pueden quitar sucursales sin personal activo ni cuentas abiertas."
          confirmLabel="Quitar sucursal"
          danger
          pending={deletePending}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}

function BranchModal({
  branch,
  restaurantName,
  defaultTimeZone,
  onClose,
  onSave,
}: {
  branch?: Branch;
  restaurantName: string;
  defaultTimeZone: string;
  onClose: () => void;
  onSave: (payload: {
    name: string;
    address?: string;
    timeZone: string;
    restaurantName?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(branch?.name ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [timeZone, setTimeZone] = useState(branch?.timeZone ?? defaultTimeZone);
  const [orgName, setOrgName] = useState(restaurantName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Escribe el nombre de la sucursal.");
    if (branch && !orgName.trim()) return setError("Escribe el nombre del restaurante.");
    setPending(true);
    try {
      await onSave({
        name: name.trim(),
        address: address.trim() || undefined,
        timeZone,
        ...(branch ? { restaurantName: orgName.trim() } : {}),
      });
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos guardar la sucursal."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={branch ? `Editar ${branch.name}` : "Agregar sucursal"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="branch-form" className="site-button" disabled={pending}>
            {pending ? "Guardando…" : branch ? "Guardar" : "Agregar sucursal"}
          </Button>
        </>
      }
    >
      <form id="branch-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-field">
          <label htmlFor="br-name">Nombre de la sucursal</label>
          <input
            id="br-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sucursal Condesa"
            required
            autoFocus
          />
        </div>
        <div className="az-field">
          <label htmlFor="br-addr">Dirección (opcional)</label>
          <input
            id="br-addr"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Av. Álvaro Obregón 120, Roma Norte, CDMX"
          />
        </div>
        <div className="az-field">
          <label htmlFor="br-tz">Zona horaria</label>
          <select id="br-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
        {branch && (
          <div className="az-field">
            <label htmlFor="br-org">Nombre del restaurante</label>
            <input
              id="br-org"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
            />
            <span className="text-xs text-muted-foreground">Se aplica a todas las sucursales.</span>
          </div>
        )}
        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}
