"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ToastBanner, useToast } from "@/components/restaurant/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage, formatElapsedMinutes, todayIsoDate } from "@/lib/format";
import { PREPARATION_AREA_META } from "@/lib/restaurant-roles";

const statusLabel = {
  ordered: "Solicitada",
  preparing: "En preparación",
  ready: "Lista para llevar",
  delivered: "Repuesta",
  cancelled: "Cancelada",
};

export function BuffetServicePanel({ timeZone, isAdmin }: { timeZone: string; isAdmin: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const [now, setNow] = useState(() => Date.now());
  const data = useQuery(api.buffet.serviceSnapshot, isAuthenticated
    ? { menuDate: todayIsoDate(timeZone, new Date(now)) }
    : "skip");
  const requestReplenishment = useMutation(api.buffet.requestReplenishment);
  const updateReplenishment = useMutation(api.buffet.updateReplenishment);
  const { toast, showToast } = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  async function request(menuId: Id<"buffetMenus">, dishId: Id<"dishes">) {
    setBusyKey(`${menuId}:${dishId}`);
    try {
      const result = await requestReplenishment({ menuId, dishId });
      showToast(result.created ? "Reposición enviada" : "Ya hay una reposición en curso");
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos pedir la reposición."), "err");
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmReplenished(batchId: Id<"buffetBatches">) {
    setBusyKey(batchId);
    try {
      await updateReplenishment({ batchId, status: "delivered" });
      showToast("Bandeja repuesta");
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos confirmar la reposición."), "err");
    } finally {
      setBusyKey(null);
    }
  }

  const active = [...(data?.active ?? [])].sort((a, b) => Number(b.status === "ready") - Number(a.status === "ready") ||
    a.requestedAt - b.requestedAt);

  return (
    <div className="az-page">
      <header className="az-page-head">
        <h1>Servicio de buffet</h1>
        {isAdmin && data?.enabled && (
          <Link href="/cuenta/administracion/buffet" className="text-sm font-semibold underline underline-offset-4">
            Configurar menús
          </Link>
        )}
      </header>

      {!data && <p role="status" className="text-sm text-muted-foreground">Cargando el buffet…</p>}

      {active.length > 0 && (
        <section className="grid gap-2" aria-labelledby="buffet-in-progress">
          <h2 id="buffet-in-progress" className="text-base font-bold">Reposiciones en curso</h2>
          <ul className="az-rows">
            {active.map((batch) => (
              <li key={batch._id}>
                <div className="az-row-text min-w-0">
                  <strong>{batch.dishName}</strong>
                  <p className="text-sm text-muted-foreground">
                    {batch.destination} · 1 bandeja · {formatElapsedMinutes(batch.requestedAt, now).label}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`az-badge ${batch.status === "ready" ? "success" : ""}`}>
                    {statusLabel[batch.status]}
                  </span>
                  {batch.status === "ready" && (
                    <Button className="site-button min-h-11" disabled={busyKey !== null}
                      aria-label={`Marcar repuesta la bandeja de ${batch.dishName}`}
                      onClick={() => void confirmReplenished(batch._id)}>
                      <Check aria-hidden="true" />
                      {busyKey === batch._id ? "Confirmando…" : "Marcar repuesta"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.menus.length === 0 && (
        <EmptyState
          icon={<UtensilsCrossed className="size-6" aria-hidden="true" />}
          title={data.enabled ? "Sin menú de buffet activo hoy" : "Buffet desactivado"}
          description={data.enabled
            ? "Pide a administración que active un menú para la fecha de hoy."
            : "La sucursal debe operar en modo Buffet o Mixto para pedir reposiciones."}
        />
      )}

      {data?.menus.map((menu) => {
        const stations = new Map<string, typeof menu.dishes>();
        for (const dish of menu.dishes) {
          const dishes = stations.get(dish.destination);
          if (dishes) dishes.push(dish);
          else stations.set(dish.destination, [dish]);
        }

        return (
          <section key={menu._id} className="grid gap-3" aria-labelledby={`buffet-${menu._id}`}>
            <h2 id={`buffet-${menu._id}`} className="text-lg font-bold">{menu.name}</h2>
            {stations.size === 0 && <p className="text-sm text-muted-foreground">Este menú aún no tiene platillos.</p>}
            {[...stations].map(([station, dishes]) => (
              <div key={station} className="grid gap-1.5">
                <h3 className="text-sm font-semibold text-muted-foreground">{station}</h3>
                <ul className="az-rows">
                  {dishes.map((dish) => (
                    <li key={dish._id}>
                      <div className="az-row-text min-w-0">
                        <strong>{dish.name}</strong>
                        <p className="text-sm text-muted-foreground">
                          {dish.portions} {dish.portions === 1 ? "porción" : "porciones"} por bandeja
                          {dish.area ? ` · ${PREPARATION_AREA_META[dish.area].name}` : " · Sin área de preparación activa"}
                        </p>
                      </div>
                      {dish.hasOpenRequest ? (
                        <span className="az-badge">Reposición en curso</span>
                      ) : (
                        <Button className="site-button min-h-11" disabled={busyKey !== null || !dish.area}
                          aria-label={`Pedir reposición de ${dish.name}`}
                          onClick={() => void request(menu._id, dish._id)}>
                          {busyKey === `${menu._id}:${dish._id}` ? "Enviando…" : "Pedir reposición"}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}

      {!!data?.recent.length && (
        <details className="grid gap-2">
          <summary className="cursor-pointer py-2 text-sm font-semibold">Reposiciones recientes</summary>
          <ul className="az-rows">
            {data.recent.map((batch) => {
              const elapsed = formatElapsedMinutes(batch.requestedAt, batch.updatedAt);
              return (
                <li key={batch._id}>
                  <div className="az-row-text">
                    <strong>{batch.dishName}</strong>
                    <span className="text-sm text-muted-foreground">{batch.destination}</span>
                  </div>
                  <span className="az-badge success">Repuesta en {elapsed.mins ? elapsed.label : "menos de 1 min"}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}
