"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { AlertTriangle, Ban, Check, ChefHat, Clock, Flame, Layers, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AdminPageHead,
  EmptyState,
  ToastBanner,
  useToast,
} from "@/components/restaurant/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { errorMessage, formatElapsedMinutes } from "@/lib/format";
import { PREPARATION_AREA_META, type PreparationArea } from "@/lib/restaurant-roles";

type Snapshot = NonNullable<ReturnType<typeof usePreloadedQuery<typeof api.kitchen.snapshot>>>;
type Ticket = Snapshot["tickets"][number];
type TicketItem = Ticket["items"][number];
type Replenishment = Snapshot["replenishments"][number];
type ColumnStage = "ordered" | "preparing" | "ready";

export function KitchenPanel({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.kitchen.snapshot>;
}) {
  const data = usePreloadedQuery(preloaded);
  const startTicket = useMutation(api.kitchen.startTicket);
  const startItemUnits = useMutation(api.kitchen.startItemUnits);
  const markTicketReady = useMutation(api.kitchen.markTicketReady);
  const markItemReadyUnits = useMutation(api.kitchen.markItemReadyUnits);
  const acknowledgeCancelled = useMutation(api.kitchen.acknowledgeCancelledTicket);
  const updateReplenishment = useMutation(api.buffet.updateReplenishment);
  const { toast, showToast } = useToast();

  const [areaFilter, setAreaFilter] = useState<"all" | PreparationArea>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const showAreaFilters = data.allowedAreas.length > 1;
  const activeFilter: "all" | PreparationArea =
    areaFilter !== "all" && data.allowedAreas.some((a) => a.area === areaFilter)
      ? areaFilter
      : "all";

  const visibleTickets = useMemo(() => {
    if (activeFilter === "all") return data.tickets;
    return data.tickets.filter((t) => t.area === activeFilter);
  }, [data.tickets, activeFilter]);
  const visibleReplenishments = data.replenishments.filter((batch) => activeFilter === "all" || batch.area === activeFilter);

  const columns = useMemo(
    () => [
      {
        stage: "ordered" as const,
        title: "Nuevos",
        empty: "Sin pedidos nuevos.",
        tickets: visibleTickets.filter((t) => t.hasPending),
      },
      {
        stage: "preparing" as const,
        title: "Preparando",
        empty: "Nada en preparación.",
        tickets: visibleTickets.filter((t) => t.hasInProgress),
      },
      {
        stage: "ready" as const,
        title: "Listos",
        empty: "Sin pedidos esperando entrega.",
        tickets: visibleTickets.filter((t) => t.hasReadyUndelivered),
      },
    ],
    [visibleTickets],
  );

  async function handleStartTicket(ticket: Ticket) {
    setBusyKey(`${ticket.key}:start`);
    try {
      await startTicket({ orderId: ticket.orderId, stationId: ticket.stationId });
      showToast(`${ticket.destinationLabel} (${ticket.stationName}) en preparación`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos iniciar la preparación."), "err");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleStartUnits(item: TicketItem, qty: number, ticket: Ticket) {
    setBusyKey(`${item.preparationId}:start`);
    try {
      await startItemUnits({ preparationId: item.preparationId, quantity: qty });
      showToast(`${qty} × ${item.dishName} (${ticket.destinationLabel}) en preparación`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos iniciar la preparación."), "err");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleReadyTicket(ticket: Ticket) {
    setBusyKey(`${ticket.key}:ready`);
    try {
      await markTicketReady({ orderId: ticket.orderId, stationId: ticket.stationId });
      showToast(`${ticket.destinationLabel} (${ticket.stationName}) marcado listo`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos marcar el pedido como listo."), "err");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleReadyUnits(item: TicketItem, qty: number, ticket: Ticket) {
    setBusyKey(`${item.preparationId}:ready`);
    try {
      await markItemReadyUnits({ preparationId: item.preparationId, quantity: qty });
      showToast(`${qty} × ${item.dishName} (${ticket.destinationLabel}) marcado listo`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos marcar como listo."), "err");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAcknowledgeCancelled(ticket: Ticket) {
    setBusyKey(`${ticket.key}:ack`);
    try {
      await acknowledgeCancelled({ orderId: ticket.orderId, stationId: ticket.stationId });
      showToast(`${ticket.destinationLabel}: cancelaciones confirmadas`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos confirmar la cancelación."), "err");
    } finally {
      setBusyKey(null);
    }
  }

  async function updateBatch(batch: Replenishment, status: "preparing" | "ready") {
    setBusyKey(batch._id);
    try {
      await updateReplenishment({ batchId: batch._id, status });
      showToast(status === "preparing" ? "Bandeja en preparación" : "Bandeja lista para llevar");
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos actualizar la reposición."), "err");
    } finally {
      setBusyKey(null);
    }
  }

  const pageTitle =
    data.allowedAreas.length === 1
      ? `Pedidos de ${data.allowedAreas[0].name}`
      : "Pedidos por estación";

  const board = columns.map((col) => {
    const batches = visibleReplenishments.filter((batch) => batch.status === col.stage);
    return { ...col, batches, count: col.tickets.length + batches.length };
  });
  const [ordered, preparing, ready] = board.map((col) => col.count);

  return (
    <div className="az-page">
      <AdminPageHead
        index={1}
        total={1}
        restaurantName={data.restaurantName}
        locationName={data.locationName}
        title={pageTitle}
        subtitle={`${ordered} ${ordered === 1 ? "nuevo" : "nuevos"} · ${preparing} en preparación · ${ready} ${ready === 1 ? "listo" : "listos"}`}
      />

      {showAreaFilters && (
        <div className="az-chips" role="group" aria-label="Filtrar por estación">
          <button
            type="button"
            className="az-chip"
            aria-pressed={activeFilter === "all"}
            onClick={() => setAreaFilter("all")}
          >
            Todas ({data.tickets.length + data.replenishments.length})
          </button>
          {data.allowedAreas.map((entry) => {
            const count = data.tickets.filter((t) => t.area === entry.area).length +
              data.replenishments.filter((batch) => batch.area === entry.area).length;
            return (
              <button
                key={entry.area}
                type="button"
                className="az-chip"
                aria-pressed={activeFilter === entry.area}
                onClick={() => setAreaFilter(entry.area)}
              >
                {entry.name} ({count})
              </button>
            );
          })}
        </div>
      )}

      {visibleTickets.length === 0 && visibleReplenishments.length === 0 ? (
        <EmptyState
          icon={<ChefHat className="size-7" aria-hidden="true" />}
          title={data.allowedAreas.length ? "Sin pedidos activos" : "Área de preparación desactivada"}
          description={
            data.allowedAreas.length === 0
              ? "Administración puede activar el área en Menú → Áreas."
              : data.allowedAreas.length === 1
              ? `Cuando un mesero envíe platillos para ${data.allowedAreas[0].name}, aparecerán aquí al instante.`
              : "Cuando los meseros envíen órdenes a tus estaciones, aparecerán aquí al instante."
          }
        />
      ) : (
        <div className="az-kitchen-board">
          {board.map((col) => (
            <section key={col.stage} className="az-kanban-col" aria-label={col.title}>
              <div className="az-kanban-head">
                <span>{col.title}</span>
                <span className="az-count">{col.count}</span>
              </div>

              {col.count === 0 && <p className="text-xs text-muted-foreground py-3 px-1">{col.empty}</p>}
              {col.batches.map((batch) => (
                <BuffetTicket
                  key={batch._id}
                  batch={batch}
                  now={now}
                  busy={busyKey === batch._id}
                  showStation={showAreaFilters}
                  onUpdate={(status) => void updateBatch(batch, status)}
                />
              ))}
              {col.tickets.map((ticket) => (
                  <KitchenTicketCard
                    key={`${col.stage}-${ticket.key}`}
                    columnStage={col.stage}
                    ticket={ticket}
                    now={now}
                    showStationBadge={showAreaFilters}
                    lateEnabled={data.autoLateOrderEnabled}
                    lateMinutes={data.autoLateOrderMinutes}
                    busyKey={busyKey}
                    onStartTicket={() => void handleStartTicket(ticket)}
                    onStartUnits={(item, qty) => void handleStartUnits(item, qty, ticket)}
                    onReadyTicket={() => void handleReadyTicket(ticket)}
                    onReadyUnits={(item, qty) => void handleReadyUnits(item, qty, ticket)}
                    onAcknowledgeCancelled={() => void handleAcknowledgeCancelled(ticket)}
                  />
              ))}
            </section>
          ))}
        </div>
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}

function BuffetTicket({ batch, now, busy, showStation, onUpdate }: {
  batch: Replenishment;
  now: number;
  busy: boolean;
  showStation: boolean;
  onUpdate: (status: "preparing" | "ready") => void;
}) {
  return (
    <article className={`az-ticket${batch.status === "ready" ? " ready" : ""}`} aria-label={`Reposición de ${batch.dishName}`}>
      <div className="az-ticket-head">
        <div className="min-w-0">
          <h3 className="az-ticket-title break-words">{batch.dishName}</h3>
          <p className="text-sm text-muted-foreground break-words">{batch.destination}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="az-badge accent">Buffet</span>
          <span className="az-badge">
            <Clock aria-hidden="true" />{formatElapsedMinutes(batch.requestedAt, now).label}
          </span>
        </div>
      </div>
      <p className="text-sm font-medium">
        1 bandeja · {batch.portions} {batch.portions === 1 ? "porción" : "porciones"}
        {showStation && ` · ${PREPARATION_AREA_META[batch.area].name}`}
      </p>
      {batch.status === "ordered" && (
        <Button className="site-button az-coral-cta w-full min-h-11" disabled={busy}
          onClick={() => onUpdate("preparing")}>
          <Flame aria-hidden="true" /> Empezar a preparar
        </Button>
      )}
      {batch.status !== "ready" ? (
        <Button
          variant={batch.status === "ordered" ? "outline" : "default"}
          className={`w-full min-h-11 ${batch.status === "preparing" ? "site-button" : ""}`}
          disabled={busy}
          onClick={() => onUpdate("ready")}
        >
          <Check aria-hidden="true" /> {batch.status === "ordered" ? "Ya está lista" : "Lista para llevar"}
        </Button>
      ) : (
        <p className="text-sm font-semibold">Lista para llevar al buffet</p>
      )}
    </article>
  );
}

function KitchenTicketCard({
  columnStage,
  ticket,
  now,
  showStationBadge,
  lateEnabled,
  lateMinutes,
  busyKey,
  onStartTicket,
  onStartUnits,
  onReadyTicket,
  onReadyUnits,
  onAcknowledgeCancelled,
}: {
  columnStage: ColumnStage;
  ticket: Ticket;
  now: number;
  showStationBadge: boolean;
  lateEnabled: boolean;
  lateMinutes: number;
  busyKey: string | null;
  onStartTicket: () => void;
  onStartUnits: (item: TicketItem, qty: number) => void;
  onReadyTicket: () => void;
  onReadyUnits: (item: TicketItem, qty: number) => void;
  onAcknowledgeCancelled: () => void;
}) {
  const elapsed = formatElapsedMinutes(ticket.createdAt, now);
  const isLate = columnStage !== "ready" && lateEnabled && elapsed.mins >= lateMinutes;

  const columnItems = ticket.items.filter((item) => {
    if (item.isCancelled) {
      if (columnStage === "ordered") return item.startedQuantity === 0;
      if (columnStage === "preparing") return item.startedQuantity > 0 && item.readyQuantity === 0;
      return item.readyQuantity > 0;
    }
    if (columnStage === "ordered") return item.pendingQuantity > 0;
    if (columnStage === "preparing") return item.inProgressQuantity > 0;
    return item.readyUndeliveredQuantity > 0;
  });

  const activeColumnItems = columnItems.filter((item) => !item.isCancelled);
  const cancelledColumnItems = columnItems.filter((item) => item.isCancelled);

  const totalSliceUnits = activeColumnItems.reduce((sum, item) => {
    if (columnStage === "ordered") return sum + item.pendingQuantity;
    if (columnStage === "preparing") return sum + item.inProgressQuantity;
    return sum + item.readyUndeliveredQuantity;
  }, 0);

  const anyWaitingOther =
    columnStage === "ready" && activeColumnItems.some((item) => item.waitingOnOtherQuantity > 0);
  const allWaitingOther =
    columnStage === "ready" &&
    activeColumnItems.length > 0 &&
    activeColumnItems.every((item) => item.waitingOnOtherQuantity >= item.readyUndeliveredQuantity);

  const cardClass = [
    "az-ticket",
    columnStage === "ready" ? "ready" : "",
    isLate ? "late" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const cardBusy =
    busyKey === `${ticket.key}:start` ||
    busyKey === `${ticket.key}:ready` ||
    busyKey === `${ticket.key}:ack` ||
    columnItems.some(
      (i) => busyKey === `${i.preparationId}:start` || busyKey === `${i.preparationId}:ready`,
    );

  return (
    <article className={cardClass} data-ticket-id={`${columnStage}-${ticket.key}`}>
      <div className="az-ticket-head">
        <div className="min-w-0">
          <div className="az-ticket-title">{ticket.destinationLabel}</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Folio A-{String(ticket.folio).padStart(4, "0")}
            {ticket.sectionName ? ` · ${ticket.sectionName}` : ""}
            {ticket.waiterName ? ` · ${ticket.waiterName}` : ""}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`az-badge ${isLate ? "warn" : ""}`}>
            {isLate ? <AlertTriangle aria-hidden="true" /> : <Clock aria-hidden="true" />}
            {elapsed.label}
          </span>
          {showStationBadge && (
            <span className="az-badge accent">{ticket.stationName}</span>
          )}
        </div>
      </div>

      <ul className="az-ticket-items">
        {columnItems.map((item) => (
          <KitchenTicketItemRow
            key={`${columnStage}-${item.preparationId as Id<"orderItemPreparations">}`}
            columnStage={columnStage}
            item={item}
            multiItemTicket={activeColumnItems.length > 1}
            busy={cardBusy}
            onStartUnits={(qty) => onStartUnits(item, qty)}
            onReadyUnits={(qty) => onReadyUnits(item, qty)}
          />
        ))}
      </ul>

      {cancelledColumnItems.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
          disabled={cardBusy}
          onClick={onAcknowledgeCancelled}
        >
          <Ban className="size-3.5" aria-hidden="true" />
          {busyKey === `${ticket.key}:ack` ? "Confirmando…" : "Entendido · quitar cancelados"}
        </Button>
      )}

      {columnStage === "ordered" && activeColumnItems.length > 0 && (
        <Button
          type="button"
          className="site-button az-coral-cta w-full"
          disabled={cardBusy}
          onClick={onStartTicket}
        >
          <Flame className="size-4" aria-hidden="true" />
          {busyKey === `${ticket.key}:start`
            ? "Iniciando…"
            : totalSliceUnits > 1
              ? `Empezar todo (${totalSliceUnits})`
              : "Empezar a preparar"}
        </Button>
      )}

      {columnStage === "preparing" && activeColumnItems.length > 0 && (
        <Button
          type="button"
          className="site-button w-full"
          disabled={cardBusy}
          onClick={onReadyTicket}
        >
          <Check className="size-4" aria-hidden="true" />
          {busyKey === `${ticket.key}:ready`
            ? "Marcando…"
            : totalSliceUnits > 1
              ? `Marcar todo listo (${totalSliceUnits})`
              : "Marcar listo"}
        </Button>
      )}

      {columnStage === "ready" && activeColumnItems.length > 0 && (
        <div className="flex items-center gap-2 text-xs font-semibold text-[#3c4124]">
          <Check className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {allWaitingOther
              ? "Tu parte está lista · esperando a la otra estación para entrega."
              : anyWaitingOther
                ? "Algunos platillos están listos para el mesero; otros esperan a otra estación."
                : "Listo para que el mesero lo entregue."}
          </span>
        </div>
      )}
    </article>
  );
}

function KitchenTicketItemRow({
  columnStage,
  item,
  multiItemTicket,
  busy,
  onStartUnits,
  onReadyUnits,
}: {
  columnStage: ColumnStage;
  item: TicketItem;
  multiItemTicket: boolean;
  busy: boolean;
  onStartUnits: (qty: number) => void;
  onReadyUnits: (qty: number) => void;
}) {
  const [pickedQty, setPickedQty] = useState(1);

  if (item.isCancelled) {
    return (
      <li className="az-ticket-item rounded-lg bg-destructive/8 p-2 border border-destructive/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-sm font-bold leading-snug line-through text-destructive">
            {item.quantity} × {item.dishName}
          </strong>
          <span className="az-badge danger">
            <Ban aria-hidden="true" />
            NO PREPARAR
          </span>
        </div>
        {item.cancelReason && (
          <p className="text-xs text-destructive/90">Motivo: {item.cancelReason}</p>
        )}
      </li>
    );
  }

  const sliceQty =
    columnStage === "ordered"
      ? item.pendingQuantity
      : columnStage === "preparing"
        ? item.inProgressQuantity
        : item.readyUndeliveredQuantity;

  const clampedQty = Math.max(1, Math.min(sliceQty, pickedQty));
  const showPartialControl =
    (columnStage === "ordered" || columnStage === "preparing") &&
    (sliceQty > 1 || multiItemTicket);

  return (
    <li className="az-ticket-item">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-sm font-bold leading-snug">
          {sliceQty} × {item.dishName}
        </strong>
        {item.quantity > sliceQty && (
          <span className="text-[11px] font-semibold text-muted-foreground">
            {columnStage === "ordered"
              ? `${item.startedQuantity}/${item.quantity} en curso`
              : columnStage === "preparing"
                ? `${item.readyQuantity}/${item.quantity} listos`
                : `de ${item.quantity} en total`}
          </span>
        )}
      </div>

      {item.modifiers.length > 0 && (
        <p className="text-xs text-[#2a2620]">{item.modifiers.join(", ")}</p>
      )}

      {item.comments && (
        <p className="text-xs font-medium text-[#7a261a]">Nota: {item.comments}</p>
      )}

      {item.otherStations.length > 0 && (
        <div className="az-cluster mt-0.5">
          {item.otherStations.map((other) => (
            <span key={`${other.area}-${other.stationName}`} className="az-badge">
              <Layers aria-hidden="true" />
              {other.stationName}: {other.readyQuantity}/{item.quantity} listos
            </span>
          ))}
        </div>
      )}

      {showPartialControl && (
        <div className="flex items-center justify-between gap-2 pt-1.5">
          {sliceQty > 1 ? (
            <span className="az-stepper">
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label={`Menos cantidad de ${item.dishName}`}
                disabled={busy || clampedQty <= 1}
                onClick={() => setPickedQty(Math.max(1, clampedQty - 1))}
              >
                <Minus aria-hidden="true" />
              </Button>
              <output>
                {clampedQty}/{sliceQty}
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label={`Más cantidad de ${item.dishName}`}
                disabled={busy || clampedQty >= sliceQty}
                onClick={() => setPickedQty(Math.min(sliceQty, clampedQty + 1))}
              >
                <Plus aria-hidden="true" />
              </Button>
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">1 platillo</span>
          )}

          {columnStage === "ordered" ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => onStartUnits(clampedQty)}
            >
              <Flame className="size-3" aria-hidden="true" />
              {sliceQty > 1 ? `Iniciar ${clampedQty}` : "Iniciar"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => onReadyUnits(clampedQty)}
            >
              <Check className="size-3" aria-hidden="true" />
              {sliceQty > 1
                ? clampedQty === 1
                  ? "1 listo"
                  : `${clampedQty} listos`
                : "Listo"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
