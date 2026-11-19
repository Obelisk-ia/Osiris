"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { Check, ChevronRight, Grid2x2, Receipt, Utensils } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AdminPageHead, EmptyState, ToastBanner, useToast } from "@/components/restaurant/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { errorMessage, formatMoney } from "@/lib/format";

const PROGRESS_STEPS = ["Enviado", "Preparando", "Listo", "Entregado"] as const;

const STAGE_LABELS: Record<string, string> = {
  ordered: "enviado a cocina",
  preparing: "preparando",
  ready: "listo para entregar",
  delivered: "entregado",
};

const TABLE_STATUS_META = {
  occupied: { label: "Ocupada", badgeCls: "", icon: Utensils },
  ready: { label: "Pedido listo", badgeCls: "success", icon: Check },
  payment: { label: "Quiere pagar", badgeCls: "warn", icon: Receipt },
} as const;

export function OrderProgressBar({ step }: { step: number }) {
  if (step < 0) return null;
  return (
    <ol className="az-progress" aria-label="Progreso del pedido">
      {PROGRESS_STEPS.map((label, idx) => {
        const isOn = idx <= step;
        const isCurrent = idx === step;
        return (
          <li
            key={label}
            className={`${isOn ? "on" : ""}${isCurrent ? " current" : ""}`}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span className="az-progress-bar" />
            <span className="az-progress-label">
              {idx < step && <Check aria-hidden="true" />}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function formatElapsed(openedAt: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - openedAt) / 60_000));
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `hace ${hours} h ${rem} min`;
}

export function WaiterTablesPanel({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.waiter.tablesSnapshot>;
}) {
  const data = usePreloadedQuery(preloaded);
  const markDelivered = useMutation(api.waiter.markAccountDelivered);
  const { toast, showToast } = useToast();
  const [busyDeliverId, setBusyDeliverId] = useState<Id<"accounts"> | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function handleDeliver(accountId: Id<"accounts">, tableNumber: string) {
    setBusyDeliverId(accountId);
    try {
      await markDelivered({ accountId });
      showToast(`${tableNumber}: marcado como entregado`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos marcarlo como entregado."), "err");
    } finally {
      setBusyDeliverId(null);
    }
  }

  const totalVisible = data.busyTables.length + data.freeTables.length;

  return (
    <div className="az-page narrow">
      <AdminPageHead
        index={1}
        total={2}
        restaurantName={data.restaurantName}
        locationName={data.locationName}
        title="Mis mesas"
        subtitle={`${data.busyTables.length} ocupadas · ${data.freeTables.length} libres`}
      />

      {totalVisible === 0 ? (
        <EmptyState
          icon={<Grid2x2 className="size-7" aria-hidden="true" />}
          title="Todavía no tienes mesas"
          description="Cuando tu dueño o gerente agregue mesas al plano o te asigne una sección, aparecerán aquí."
        />
      ) : (
        <div className="grid gap-6">
          {data.busyTables.length > 0 && (
            <section className="grid gap-3" aria-label="Mesas ocupadas">
              {data.busyTables.map((table) => {
                const meta = TABLE_STATUS_META[table.status];
                const StatusIcon = meta.icon;
                return (
                  <article
                    key={table.tableId}
                    className={`az-waiter-row${table.status === "ready" ? " ready" : ""}`}
                  >
                    <Link
                      href={`/cuenta/mesero/cuenta/${table.accountId}`}
                      className="az-waiter-head"
                      aria-label={`Abrir ${table.tableNumber}`}
                    >
                      <span className="flex-1 min-w-0">
                        <strong>{table.tableNumber}</strong>
                        <span className="text-xs text-muted-foreground">
                          <span className="az-money text-foreground">
                            {formatMoney(table.totalCents, data.currencyCode)}
                          </span>{" "}
                          · {formatElapsed(table.openedAt, now)} · {table.sectionName}
                        </span>
                      </span>
                      <span className={`az-badge ${meta.badgeCls}`}>
                        <StatusIcon aria-hidden="true" />
                        {meta.label}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>

                    <OrderProgressBar step={table.progressStep} />

                    {table.areaSummaries.length > 0 ? (
                      <ul className="grid gap-1.5 text-sm">
                        {table.areaSummaries.map((area, idx) => (
                          <li key={`${area.stationName}-${idx}`}>
                            <strong className="font-semibold">
                              {area.stationName}: {STAGE_LABELS[area.status] ?? area.status}
                            </strong>
                            <p className="text-xs text-muted-foreground">{area.itemsText}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {table.itemCount === 0
                          ? "Sin productos todavía. Entra para tomar la orden."
                          : table.status === "payment"
                            ? "Todo entregado. Ya pidieron la cuenta."
                            : "Todo entregado."}
                      </p>
                    )}

                    {table.hasUndelivered && (
                      <Button
                        type="button"
                        className={table.hasReady ? "site-button az-coral-cta w-full" : "w-full"}
                        variant={table.hasReady ? "default" : "outline"}
                        disabled={busyDeliverId === table.accountId}
                        onClick={() => void handleDeliver(table.accountId, table.tableNumber)}
                      >
                        <Check className="size-4" aria-hidden="true" />
                        {busyDeliverId === table.accountId ? "Marcando…" : "Marcar entregado"}
                      </Button>
                    )}
                  </article>
                );
              })}
            </section>
          )}

          {data.freeTables.length > 0 && (
            <section className="grid gap-3">
              <h2 className="font-heading text-xl font-bold">Libres</h2>
              <ul className="az-rows">
                {data.freeTables.map((table) => (
                  <li key={table.tableId} className="!p-0">
                    <Link
                      href={`/cuenta/mesero/mesa/${table.tableId}`}
                      className="az-row-link"
                    >
                      <span className="flex-1 min-w-0">
                        <strong className="block truncate text-[15px]">{table.tableNumber}</strong>
                        <span className="block truncate text-xs text-muted-foreground">
                          {table.seatCount} personas · {table.sectionName}
                          {table.isUnassignedSection ? " · Libre de mesero" : ""}
                        </span>
                      </span>
                      <span className="az-waiter-cta">Tomar orden</span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}
