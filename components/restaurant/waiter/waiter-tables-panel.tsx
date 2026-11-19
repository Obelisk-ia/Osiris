"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import {
  BadgeCheck,
  Check,
  ChevronRight,
  Circle,
  Clock,
  Flame,
  Grid2x2,
  Layers,
  Receipt,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AdminPageHead,
  EmptyState,
  ToastBanner,
  useToast,
} from "@/components/restaurant/admin/admin-ui";
import { PAYMENT_METHOD_LABELS } from "@/components/restaurant/cashier/charge-modal";
import {
  ReportPaymentModal,
  type ReportPaymentTarget,
} from "@/components/restaurant/waiter/report-payment-modal";
import { Button } from "@/components/ui/button";
import { readDraftSummaries, type StoredDraftSummary } from "@/lib/draft-storage";
import { errorMessage, formatMoney } from "@/lib/format";

const PROGRESS_STEPS = ["Enviado", "Preparando", "Listo", "Entregado"] as const;

const TABLE_STATUS_META = {
  occupied: { label: "Ocupada", badgeCls: "", icon: Utensils },
  partial: { label: "Entrega parcial", badgeCls: "partial", icon: Layers },
  ready: { label: "Pedido listo", badgeCls: "success", icon: Check },
  payment: { label: "Quiere pagar", badgeCls: "warn", icon: Receipt },
} as const;

export type PlateSummary = {
  orderItemId: Id<"orderItems">;
  dishName: string;
  quantity: number;
  effectiveReadyQuantity: number;
  deliveredQuantity: number;
  deliverableQuantity: number;
  preparingQuantity: number;
  pendingQuantity: number;
  comments: string;
  modifiersText: string;
  status: "ordered" | "preparing" | "ready" | "delivered" | "cancelled";
  progressStep: number;
  stationLabel: string;
  stations: Array<{
    stationId: Id<"preparationStations">;
    stationName: string;
    area: "kitchen" | "bar" | "cocktails" | "coffee";
    startedQuantity: number;
    readyQuantity: number;
    status: "ordered" | "preparing" | "ready" | "delivered" | "cancelled";
  }>;
};

type ChecklistRow = {
  key: string;
  orderItemId: Id<"orderItems">;
  dishName: string;
  unitLabel: string | null;
  modifiersText: string;
  comments: string;
  stage: "ready" | "preparing" | "ordered" | "delivered";
  deliverQty: number;
};

const CHECKLIST_STAGE_ORDER: Record<ChecklistRow["stage"], number> = {
  ready: 0,
  preparing: 1,
  ordered: 2,
  delivered: 3,
};

function expandPlatesToChecklist(plates: PlateSummary[]): ChecklistRow[] {
  const rows: ChecklistRow[] = [];

  for (const plate of plates) {
    // Expand up to 8 identical units into individual checkable plate rows so the
    // waiter can check off each plate one by one until all are delivered.
    if (plate.quantity <= 8) {
      let idx = 0;
      const labelFor = () => {
        idx += 1;
        return plate.quantity > 1 ? `${idx} de ${plate.quantity}` : null;
      };
      for (let i = 0; i < plate.deliveredQuantity; i++) {
        rows.push({
          key: `${plate.orderItemId}-del-${i}`,
          orderItemId: plate.orderItemId,
          dishName: plate.dishName,
          unitLabel: labelFor(),
          modifiersText: plate.modifiersText,
          comments: plate.comments,
          stage: "delivered",
          deliverQty: 0,
        });
      }
      for (let i = 0; i < plate.deliverableQuantity; i++) {
        rows.push({
          key: `${plate.orderItemId}-rdy-${i}`,
          orderItemId: plate.orderItemId,
          dishName: plate.dishName,
          unitLabel: labelFor(),
          modifiersText: plate.modifiersText,
          comments: plate.comments,
          stage: "ready",
          deliverQty: 1,
        });
      }
      for (let i = 0; i < plate.preparingQuantity; i++) {
        rows.push({
          key: `${plate.orderItemId}-prep-${i}`,
          orderItemId: plate.orderItemId,
          dishName: plate.dishName,
          unitLabel: labelFor(),
          modifiersText: plate.modifiersText,
          comments: plate.comments,
          stage: "preparing",
          deliverQty: 0,
        });
      }
      for (let i = 0; i < plate.pendingQuantity; i++) {
        rows.push({
          key: `${plate.orderItemId}-ord-${i}`,
          orderItemId: plate.orderItemId,
          dishName: plate.dishName,
          unitLabel: labelFor(),
          modifiersText: plate.modifiersText,
          comments: plate.comments,
          stage: "ordered",
          deliverQty: 0,
        });
      }
    } else {
      // Compact grouped rows for large quantities (> 8 of the same dish).
      if (plate.deliverableQuantity > 0) {
        rows.push({
          key: `${plate.orderItemId}-rdy-grp`,
          orderItemId: plate.orderItemId,
          dishName: `${plate.deliverableQuantity} × ${plate.dishName}`,
          unitLabel: `de ${plate.quantity}`,
          modifiersText: plate.modifiersText,
          comments: plate.comments,
          stage: "ready",
          deliverQty: plate.deliverableQuantity,
        });
      }
      if (plate.preparingQuantity > 0) {
        rows.push({
          key: `${plate.orderItemId}-prep-grp`,
          orderItemId: plate.orderItemId,
          dishName: `${plate.preparingQuantity} × ${plate.dishName}`,
          unitLabel: `de ${plate.quantity}`,
          modifiersText: plate.modifiersText,
          comments: plate.comments,
          stage: "preparing",
          deliverQty: 0,
        });
      }
      if (plate.pendingQuantity > 0) {
        rows.push({
          key: `${plate.orderItemId}-ord-grp`,
          orderItemId: plate.orderItemId,
          dishName: `${plate.pendingQuantity} × ${plate.dishName}`,
          unitLabel: `de ${plate.quantity}`,
          modifiersText: plate.modifiersText,
          comments: plate.comments,
          stage: "ordered",
          deliverQty: 0,
        });
      }
      if (plate.deliveredQuantity > 0) {
        rows.push({
          key: `${plate.orderItemId}-del-grp`,
          orderItemId: plate.orderItemId,
          dishName: `${plate.deliveredQuantity} × ${plate.dishName}`,
          unitLabel: `de ${plate.quantity}`,
          modifiersText: plate.modifiersText,
          comments: plate.comments,
          stage: "delivered",
          deliverQty: 0,
        });
      }
    }
  }

  return rows.sort((a, b) => CHECKLIST_STAGE_ORDER[a.stage] - CHECKLIST_STAGE_ORDER[b.stage]);
}

export function OrderProgressBar({ step, compact = false }: { step: number; compact?: boolean }) {
  if (step < 0) return null;
  return (
    <ol className={`az-progress${compact ? " compact" : ""}`} aria-label="Progreso del pedido">
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

export function PlatesProgressList({
  plates,
  deliveredUnits,
  totalUnits,
  canDeliver = true,
  busyItemId,
  busyAll,
  onDeliverItem,
  onDeliverAllReady,
}: {
  plates: PlateSummary[];
  deliveredUnits?: number;
  totalUnits?: number;
  canDeliver?: boolean;
  busyItemId: Id<"orderItems"> | null;
  busyAll?: boolean;
  onDeliverItem: (orderItemId: Id<"orderItems">, quantity: number, dishName: string) => void;
  onDeliverAllReady?: () => void;
}) {
  if (plates.length === 0) return null;

  const computedTotal = totalUnits ?? plates.reduce((sum, p) => sum + p.quantity, 0);
  const computedDelivered =
    deliveredUnits ?? plates.reduce((sum, p) => sum + p.deliveredQuantity, 0);
  const totalDeliverableUnits = plates.reduce((sum, p) => sum + p.deliverableQuantity, 0);
  const pct = computedTotal > 0 ? Math.round((computedDelivered / computedTotal) * 100) : 0;
  const allDelivered = computedTotal > 0 && computedDelivered >= computedTotal;

  const rows = expandPlatesToChecklist(plates);

  return (
    <div className="az-plate-wrap">
      <div className="az-plate-summary">
        <div className="az-plate-summary-head">
          <span>
            {allDelivered
              ? `Todos los platillos entregados (${computedDelivered}/${computedTotal})`
              : `${computedDelivered} de ${computedTotal} platillos entregados`}
          </span>
          {totalDeliverableUnits > 0 && (
            <span className="text-[#3c4124]">
              {totalDeliverableUnits === 1 ? "1 listo" : `${totalDeliverableUnits} listos`}
            </span>
          )}
        </div>
        <div className="az-plate-track" aria-hidden="true">
          <div
            className={`az-plate-fill${allDelivered ? " done" : ""}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="az-plate-list" role="list" aria-label="Platillos de la mesa">
        {rows.map((row) => {
          const isBusy = busyItemId === row.orderItemId || Boolean(busyAll);

          if (row.stage === "ready" && canDeliver) {
            return (
              <button
                key={row.key}
                type="button"
                role="listitem"
                className="az-plate-item ready"
                disabled={isBusy}
                aria-label={`Marcar ${row.dishName} como entregado`}
                onClick={() => onDeliverItem(row.orderItemId, row.deliverQty, row.dishName)}
              >
                <span className="az-plate-check" aria-hidden="true">
                  <Check className="opacity-35" />
                </span>
                <span className="flex-1 min-w-0 grid gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-1.5">
                    <strong className="text-sm font-bold leading-snug text-foreground">
                      {row.dishName}
                    </strong>
                    {row.unitLabel && (
                      <span className="text-[11px] font-medium text-muted-foreground">
                        ({row.unitLabel})
                      </span>
                    )}
                  </span>
                  {row.modifiersText && (
                    <span className="text-xs text-[#2a2620]">{row.modifiersText}</span>
                  )}
                  {row.comments && (
                    <span className="text-xs font-medium text-[#7a261a]">Nota: {row.comments}</span>
                  )}
                </span>
                <span className="az-badge success shrink-0">
                  <Check aria-hidden="true" />
                  {isBusy ? "Marcando…" : "Listo · Entregar"}
                </span>
              </button>
            );
          }

          return (
            <div
              key={row.key}
              role="listitem"
              className={`az-plate-item${row.stage === "delivered" ? " delivered" : ""}`}
            >
              <span className="az-plate-check" aria-hidden="true">
                {row.stage === "delivered" ? (
                  <Check />
                ) : row.stage === "preparing" ? (
                  <Flame className="text-[#7a261a]" />
                ) : (
                  <Circle className="opacity-45" />
                )}
              </span>
              <span className="flex-1 min-w-0 grid gap-0.5">
                <span className="flex flex-wrap items-baseline gap-1.5">
                  <strong
                    className={`text-sm font-semibold leading-snug ${row.stage === "delivered" ? "line-through text-muted-foreground" : "text-foreground"}`}
                  >
                    {row.dishName}
                  </strong>
                  {row.unitLabel && (
                    <span className="text-[11px] text-muted-foreground">({row.unitLabel})</span>
                  )}
                </span>
                {row.modifiersText && (
                  <span className="text-xs text-muted-foreground">{row.modifiersText}</span>
                )}
                {row.comments && (
                  <span className="text-xs text-[#7a261a]">Nota: {row.comments}</span>
                )}
              </span>
              {row.stage === "delivered" ? (
                <span className="az-badge success shrink-0">Entregado</span>
              ) : row.stage === "preparing" ? (
                <span className="az-badge accent shrink-0">
                  <Clock aria-hidden="true" />
                  Preparando
                </span>
              ) : row.stage === "ready" ? (
                <span className="az-badge success shrink-0">Listo</span>
              ) : (
                <span className="az-badge shrink-0">Enviado</span>
              )}
            </div>
          );
        })}
      </div>

      {canDeliver && totalDeliverableUnits > 1 && onDeliverAllReady && (
        <Button
          type="button"
          size="sm"
          className="site-button az-coral-cta w-full"
          disabled={Boolean(busyAll) || busyItemId !== null}
          onClick={onDeliverAllReady}
        >
          <Check className="size-3.5" aria-hidden="true" />
          {busyAll ? "Marcando…" : `Entregar los ${totalDeliverableUnits} listos`}
        </Button>
      )}
    </div>
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
  const deliverOrderItem = useMutation(api.waiter.deliverOrderItem);
  const deliverReady = useMutation(api.waiter.deliverReadyItems);
  const { toast, showToast } = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reportingTarget, setReportingTarget] = useState<ReportPaymentTarget | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [draftsByKey, setDraftsByKey] = useState<Record<string, StoredDraftSummary>>({});

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const ids = [
      ...data.busyTables.map((t) => String(t.accountId)),
      ...data.freeTables.map((t) => String(t.tableId)),
    ];
    const refresh = () => setDraftsByKey(readDraftSummaries(ids));
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [data.busyTables, data.freeTables]);

  async function handleDeliverItem(
    accountId: Id<"accounts">,
    orderItemId: Id<"orderItems">,
    quantity: number,
    tableNumber: string,
    dishName: string,
  ) {
    setBusyKey(`${accountId}::${orderItemId}`);
    try {
      await deliverOrderItem({ orderItemId, quantity });
      showToast(`${tableNumber}: ${dishName} entregado`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos marcarlo como entregado."), "err");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeliverAllReady(accountId: Id<"accounts">, tableNumber: string) {
    setBusyKey(`${accountId}::all`);
    try {
      await deliverReady({ accountId });
      showToast(`${tableNumber}: todos los platillos listos marcados como entregados`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos marcarlo como entregado."), "err");
    } finally {
      setBusyKey(null);
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
          title={data.tableServiceEnabled ? "Todavía no tienes mesas" : "La sucursal usa asientos libres"}
          description={data.tableServiceEnabled ? "Cuando tu dueño o gerente agregue mesas al plano o te asigne una sección, aparecerán aquí."
            : "Las reposiciones están en la pantalla de buffet."}
          action={!data.tableServiceEnabled && <Link href="/cuenta/buffet" className="text-sm font-semibold underline">Volver al buffet</Link>}
        />
      ) : (
        <div className="grid gap-6">
          {data.busyTables.length > 0 && (
            <section className="grid gap-3" aria-label="Mesas ocupadas">
              {data.busyTables.map((table) => {
                const meta = TABLE_STATUS_META[table.status];
                const StatusIcon = meta.icon;
                const rowClass = [
                  "az-waiter-row",
                  table.status === "ready" ? "ready" : "",
                  table.status === "partial" ? "partial" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                const busyItemId =
                  busyKey?.startsWith(`${table.accountId}::`) && busyKey !== `${table.accountId}::all`
                    ? (busyKey.split("::")[1] as Id<"orderItems">)
                    : null;

                return (
                  <article key={table.tableId} className={rowClass}>
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

                    {draftsByKey[String(table.accountId)] && (
                      <div className="az-notice warn">
                        <Clock className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>
                          Tienes una orden sin confirmar:{" "}
                          <strong>{draftsByKey[String(table.accountId)].summaryText}</strong>. Entra para tomarla.
                        </span>
                      </div>
                    )}

                    {table.plates.length > 0 ? (
                      <PlatesProgressList
                        plates={table.plates}
                        deliveredUnits={table.deliveredUnits}
                        totalUnits={table.totalUnits}
                        busyItemId={busyItemId}
                        busyAll={busyKey === `${table.accountId}::all`}
                        onDeliverItem={(orderItemId, qty, dishName) =>
                          void handleDeliverItem(
                            table.accountId,
                            orderItemId,
                            qty,
                            table.tableNumber,
                            dishName,
                          )
                        }
                        onDeliverAllReady={() =>
                          void handleDeliverAllReady(table.accountId, table.tableNumber)
                        }
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {table.buffetGuestCount > 0
                          ? `${table.buffetGuestCount} ${table.buffetGuestCount === 1 ? "comensal registrado" : "comensales registrados"}`
                          : data.serviceMode === "buffet" ? "Sin extras pedidos." : "Sin productos todavía. Entra para tomar la orden."}
                      </p>
                    )}

                    {table.status === "payment" && table.balanceCents > 0 && (
                      table.reportedPayment ? (
                        <div className="az-notice warn">
                          <BadgeCheck className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                          <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                            <span className="text-xs">
                              Reportaste{" "}
                              <strong>
                                {formatMoney(table.reportedPayment.receivedCents, data.currencyCode)}
                              </strong>{" "}
                              ({PAYMENT_METHOD_LABELS[table.reportedPayment.method]}). Esperando
                              confirmación de Caja para liberar la mesa.
                            </span>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() =>
                                setReportingTarget({
                                  accountId: table.accountId,
                                  label: table.tableNumber,
                                  folio: table.folio,
                                  balanceCents: table.balanceCents,
                                  existingReport: table.reportedPayment,
                                })
                              }
                            >
                              Editar reporte
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() =>
                            setReportingTarget({
                              accountId: table.accountId,
                              label: table.tableNumber,
                              folio: table.folio,
                              balanceCents: table.balanceCents,
                              existingReport: null,
                            })
                          }
                        >
                          <Receipt className="size-4" aria-hidden="true" />
                          Reportar pago a caja · {formatMoney(table.balanceCents, data.currencyCode)}
                        </Button>
                      )
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
                        {draftsByKey[String(table.tableId)] && (
                          <span className="block truncate text-xs font-medium text-[#6a4c0a] mt-0.5">
                            Borrador sin confirmar: {draftsByKey[String(table.tableId)].summaryText}
                          </span>
                        )}
                      </span>
                      <span className="az-waiter-cta">{data.serviceMode === "buffet" ? "Sentar grupo" : "Tomar orden"}</span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {reportingTarget && (
        <ReportPaymentModal
          target={reportingTarget}
          currencyCode={data.currencyCode}
          onClose={() => setReportingTarget(null)}
          onReported={(msg) => {
            setReportingTarget(null);
            showToast(msg);
          }}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}
