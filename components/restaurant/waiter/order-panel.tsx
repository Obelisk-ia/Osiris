"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import {
  ArrowLeft,
  ArrowLeftRight,
  BadgeCheck,
  Ban,
  Check,
  Edit3,
  Minus,
  MoreVertical,
  Percent,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Send,
  Undo2,
  UserCheck,
  Utensils,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AdminModal,
  ConfirmModal,
  EmptyState,
  ToastBanner,
  useToast,
} from "@/components/restaurant/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { loadStoredDraft, saveStoredDraft } from "@/lib/draft-storage";
import { errorMessage, formatDateTime, formatMoney } from "@/lib/format";
import {
  ChargeModal,
  DiscountModal,
  PAYMENT_METHOD_LABELS,
  ReopenAccountModal,
} from "@/components/restaurant/cashier/charge-modal";
import { ReportPaymentModal } from "@/components/restaurant/waiter/report-payment-modal";
import { OrderProgressBar, PlatesProgressList } from "./waiter-tables-panel";

type Workspace = NonNullable<ReturnType<typeof usePreloadedQuery<typeof api.waiter.orderWorkspace>>>;
type MenuDish = Workspace["dishes"][number];
type ModifierGroup = Workspace["modifierGroups"][number];
type AccountItem = NonNullable<Workspace["account"]>["items"][number];

type DraftModifier = {
  optionId: Id<"modifierOptions">;
  groupName: string;
  optionName: string;
  priceExtraCents: number;
};

type DraftLine = {
  key: string;
  dishId: Id<"dishes">;
  name: string;
  unitPriceCents: number;
  quantity: number;
  comments: string;
  modifiers: DraftModifier[];
};

const ACCOUNT_KIND_LABELS = {
  dine_in: "Mesa",
  takeaway: "Para llevar",
  pickup: "Para recoger",
  counter: "Barra",
} as const;

function draftLineTotal(line: DraftLine): number {
  const extra = line.modifiers.reduce((s, m) => s + m.priceExtraCents, 0);
  return (line.unitPriceCents + extra) * line.quantity;
}

function sameModifiers(a: DraftModifier[], b: DraftModifier[]): boolean {
  if (a.length !== b.length) return false;
  const aIds = a.map((m) => m.optionId).sort().join(",");
  const bIds = b.map((m) => m.optionId).sort().join(",");
  return aIds === bIds;
}

let draftSeq = 1;

export function OrderPanel({
  preloaded,
  returnHref = "/cuenta/mesas",
}: {
  preloaded: Preloaded<typeof api.waiter.orderWorkspace>;
  returnHref?: string;
}) {
  const data = usePreloadedQuery(preloaded);
  const router = useRouter();
  const { toast, showToast } = useToast();

  const submitOrder = useMutation(api.waiter.submitOrder);
  const updateItemQty = useMutation(api.waiter.updateOrderItemQuantity);
  const cancelOrderItem = useMutation(api.waiter.cancelOrderItem);
  const reassignWaiter = useMutation(api.waiter.reassignAccountWaiter);
  const deliverOrderItem = useMutation(api.waiter.deliverOrderItem);
  const deliverReady = useMutation(api.waiter.deliverReadyItems);
  const markDelivered = useMutation(api.waiter.markAccountDelivered);
  const requestBill = useMutation(api.waiter.requestBill);
  const reopenForOrdering = useMutation(api.waiter.reopenForOrdering);
  const voidEmptyAccount = useMutation(api.waiter.voidEmptyAccount);
  const moveAccountToTable = useMutation(api.waiter.moveAccountToTable);

  const storageId = data.account?._id
    ? String(data.account._id)
    : data.table?._id
      ? String(data.table._id)
      : undefined;

  const [mobileTab, setMobileTab] = useState<"menu" | "cuenta">(data.canTakeOrder ? "menu" : "cuenta");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [draft, setDraft] = useState<DraftLine[]>(() => loadStoredDraft<DraftLine>(storageId));

  useEffect(() => {
    saveStoredDraft(storageId, draft);
  }, [storageId, draft]);

  const [pickingDish, setPickingDish] = useState<MenuDish | null>(null);
  const [editingNoteLine, setEditingNoteLine] = useState<DraftLine | null>(null);
  const [cancellingItem, setCancellingItem] = useState<AccountItem | null>(null);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [billWarningOpen, setBillWarningOpen] = useState(false);
  const [leaveDraftOpen, setLeaveDraftOpen] = useState(false);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const [reportPaymentOpen, setReportPaymentOpen] = useState(false);
  const [chargeModalOpen, setChargeModalOpen] = useState(false);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [busyItemId, setBusyItemId] = useState<Id<"orderItems"> | null>(null);

  const modifierGroupMap = useMemo(
    () => new Map(data.modifierGroups.map((g) => [g._id, g] as const)),
    [data.modifierGroups],
  );

  const filteredDishes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.dishes.filter((dish) => {
      if (categoryFilter !== "all" && dish.categoryId !== categoryFilter) return false;
      if (q && !dish.name.toLowerCase().includes(q) && !dish.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [data.dishes, search, categoryFilter]);

  function dishNeedsRequiredOptions(dish: MenuDish): boolean {
    return dish.modifierGroupIds.some((gid) => modifierGroupMap.get(gid)?.required);
  }

  function addDraftEntries(
    dish: MenuDish,
    entries: Array<{ quantity: number; comments: string; modifiers: DraftModifier[] }>,
  ) {
    setDraft((prev) => {
      const next = [...prev];
      for (const entry of entries) {
        const matchIdx = next.findIndex(
          (line) =>
            line.dishId === dish._id &&
            line.comments === entry.comments &&
            sameModifiers(line.modifiers, entry.modifiers),
        );
        if (matchIdx >= 0) {
          next[matchIdx] = { ...next[matchIdx], quantity: next[matchIdx].quantity + entry.quantity };
        } else {
          next.push({
            key: `d-${++draftSeq}`,
            dishId: dish._id,
            name: dish.name,
            unitPriceCents: dish.priceCents,
            quantity: entry.quantity,
            comments: entry.comments,
            modifiers: entry.modifiers,
          });
        }
      }
      return next;
    });
  }

  function quickAddDish(dish: MenuDish) {
    if (dish.soldOut) {
      showToast(`${dish.name} está agotado.`, "err");
      return;
    }
    if (dishNeedsRequiredOptions(dish)) {
      setPickingDish(dish);
      return;
    }
    addDraftEntries(dish, [{ quantity: 1, comments: "", modifiers: [] }]);
    showToast(`1 × ${dish.name} en la orden`);
  }

  function adjustDraftQty(key: string, delta: number) {
    setDraft((prev) =>
      prev
        .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  function splitDraftLine(line: DraftLine) {
    if (line.quantity < 2) return;
    const copy: DraftLine = { ...line, key: `d-${++draftSeq}`, quantity: 1, comments: "" };
    setDraft((prev) => {
      const idx = prev.findIndex((item) => item.key === line.key);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: next[idx].quantity - 1 };
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setEditingNoteLine(copy);
  }

  const draftTotalCents = draft.reduce((sum, line) => sum + draftLineTotal(line), 0);
  const draftCount = draft.reduce((sum, line) => sum + line.quantity, 0);

  const account = data.account;
  const allItems = account?.items ?? [];
  const sentItems = allItems.filter((item) => item.status !== "cancelled");
  const cancelledItems = allItems.filter((item) => item.status === "cancelled");

  const accountTotalCents = account?.totalCents ?? 0;
  const accountGrossCents = accountTotalCents + (account?.discountCents ?? 0);
  const accountBalanceCents = account?.balanceCents ?? accountTotalCents;
  const displayTaxCents = accountTotalCents - Math.round(accountTotalCents / 1.16);
  const displaySubtotalCents = accountTotalCents - displayTaxCents;

  const accountTitle = data.table
    ? data.table.tableNumber
    : account
      ? `${ACCOUNT_KIND_LABELS[account.kind]}${account.customerName ? ` · ${account.customerName}` : ""}`
      : "Cuenta";

  async function handleConfirmOrder() {
    if (draft.length === 0 || actionPending) return;
    setActionPending(true);
    try {
      const res = await submitOrder({
        tableId: !account ? data.table?._id : undefined,
        accountId: account?._id,
        items: draft.map((line) => ({
          dishId: line.dishId,
          quantity: line.quantity,
          comments: line.comments || undefined,
          modifierOptionIds: line.modifiers.map((m) => m.optionId),
        })),
      });
      setDraft([]);
      saveStoredDraft(storageId, []);
      if (data.table?._id) saveStoredDraft(String(data.table._id), []);
      setConfirmSendOpen(false);
      showToast(`Orden enviada a ${res.stationNames.join(" y ")}`);
      router.push(returnHref);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos enviar la orden."), "err");
    } finally {
      setActionPending(false);
    }
  }

  async function handleDeliverItem(
    orderItemId: Id<"orderItems">,
    quantity: number,
    dishName: string,
  ) {
    if (!account || actionPending) return;
    setBusyItemId(orderItemId);
    try {
      await deliverOrderItem({ orderItemId, quantity });
      showToast(`${quantity} × ${dishName} marcado como entregado`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos marcarlo como entregado."), "err");
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleDeliverAllReady() {
    if (!account || actionPending) return;
    setActionPending(true);
    try {
      await deliverReady({ accountId: account._id });
      showToast("Todo lo listo marcado como entregado");
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos marcarlo como entregado."), "err");
    } finally {
      setActionPending(false);
    }
  }

  async function handleMarkDelivered() {
    if (!account || actionPending) return;
    setActionPending(true);
    try {
      await markDelivered({ accountId: account._id });
      setMoreActionsOpen(false);
      showToast("Pedido completo marcado como entregado");
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos marcarlo como entregado."), "err");
    } finally {
      setActionPending(false);
    }
  }

  async function executeRequestBill() {
    if (!account || actionPending) return;
    setActionPending(true);
    try {
      await requestBill({ accountId: account._id });
      setBillWarningOpen(false);
      showToast(`${accountTitle} pasó a caja para pagar`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos pedir la cuenta."), "err");
    } finally {
      setActionPending(false);
    }
  }

  function handleRequestBillClick() {
    if (!account || actionPending) return;
    if (draft.length > 0) {
      showToast("Tienes una orden sin confirmar. Tómala o quítala antes de pedir la cuenta.", "err");
      return;
    }
    if (account.hasUndelivered) {
      setBillWarningOpen(true);
      return;
    }
    void executeRequestBill();
  }

  function handleBackClick() {
    if (draft.length > 0) {
      setLeaveDraftOpen(true);
      return;
    }
    router.push(returnHref);
  }

  async function handleReopenOrdering() {
    if (!account || actionPending) return;
    setActionPending(true);
    try {
      await reopenForOrdering({ accountId: account._id });
      setMoreActionsOpen(false);
      showToast("Listo, ya puedes agregar productos");
    } catch (cause) {
      showToast(errorMessage(cause), "err");
    } finally {
      setActionPending(false);
    }
  }

  async function handleVoidAccount() {
    if (!account || actionPending) return;
    setActionPending(true);
    try {
      await voidEmptyAccount({ accountId: account._id });
      setVoidConfirmOpen(false);
      router.push(returnHref);
    } catch (cause) {
      showToast(errorMessage(cause), "err");
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="az-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleBackClick}
          className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver
        </button>
        <span className="text-xs font-mono text-muted-foreground">
          {data.restaurantName} · {data.locationName}
        </span>
      </div>

      <div className={`az-order${data.canTakeOrder ? "" : " single"}`}>
        {data.canTakeOrder && (
          <section
            className={`grid gap-4${mobileTab === "menu" ? "" : " az-pane-off"}`}
            aria-label="Menú"
          >
            <div className="az-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                placeholder="Buscar en el menú"
                aria-label="Buscar en el menú"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {data.categories.length > 0 && (
              <div className="az-chips" role="group" aria-label="Filtrar por categoría">
                <button
                  type="button"
                  className="az-chip"
                  aria-pressed={categoryFilter === "all"}
                  onClick={() => setCategoryFilter("all")}
                >
                  Todo
                </button>
                {data.categories.map((cat) => (
                  <button
                    key={cat._id}
                    type="button"
                    className="az-chip"
                    aria-pressed={categoryFilter === cat._id}
                    onClick={() => setCategoryFilter(cat._id)}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}

            {filteredDishes.length > 0 ? (
              <div className="az-prod-grid">
                {filteredDishes.map((dish) => (
                  <article key={dish._id} className={`az-prod${dish.soldOut ? " sold" : ""}`}>
                    <button
                      type="button"
                      className="az-prod-photo"
                      aria-label={`Ver opciones de ${dish.name}`}
                      disabled={dish.soldOut}
                      onClick={() => setPickingDish(dish)}
                    >
                      {dish.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={dish.photoUrl} alt={dish.name} loading="lazy" />
                      ) : (
                        <span className="az-prod-noimg">
                          <Utensils className="size-7" aria-hidden="true" />
                        </span>
                      )}
                    </button>
                    <div className="az-prod-body">
                      <div className="az-prod-name">{dish.name}</div>
                      {dish.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{dish.description}</p>
                      )}
                      <div className="az-money text-sm mt-auto">
                        {formatMoney(dish.priceCents, data.currencyCode)}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={dish.soldOut}
                        onClick={() => quickAddDish(dish)}
                      >
                        {dish.soldOut ? (
                          "Agotado"
                        ) : (
                          <>
                            <Plus className="size-3.5" aria-hidden="true" />
                            Agregar
                          </>
                        )}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Utensils className="size-7" aria-hidden="true" />}
                title={data.dishes.length === 0 ? "El menú aún está vacío" : "Sin resultados"}
                description={
                  data.dishes.length === 0
                    ? "Cuando el dueño o gerente agregue platillos en Menú, aparecerán aquí para tomar órdenes."
                    : "Prueba con otro nombre o cambia de categoría."
                }
              />
            )}

            <div className="az-sticky-bar">
              {draft.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" onClick={() => setMobileTab("cuenta")}>
                    Ver orden ({draftCount})
                  </Button>
                  <Button
                    type="button"
                    className="site-button az-coral-cta"
                    onClick={() => setConfirmSendOpen(true)}
                  >
                    Tomar orden
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" className="w-full" onClick={() => setMobileTab("cuenta")}>
                  Ver cuenta · {formatMoney(accountTotalCents, data.currencyCode)}
                </Button>
              )}
            </div>
          </section>
        )}

        <section
          className={`az-card az-bill${mobileTab === "cuenta" || !data.canTakeOrder ? "" : " az-pane-off"}`}
          aria-label="Cuenta"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <h1 className="font-heading text-2xl font-extrabold tracking-tight">{accountTitle}</h1>
              {account ? (
                account.state === "closed" ? (
                  <span className="az-badge success">
                    <BadgeCheck aria-hidden="true" />
                    Cobrada
                  </span>
                ) : account.state === "voided" ? (
                  <span className="az-badge danger">Anulada</span>
                ) : account.state === "awaiting_payment" ? (
                  <span className="az-badge warn">
                    <Receipt aria-hidden="true" />
                    Quiere pagar
                  </span>
                ) : account.tableStatus === "ready" ? (
                  <span className="az-badge success">
                    <Check aria-hidden="true" />
                    Pedido listo
                  </span>
                ) : account.tableStatus === "partial" ? (
                  <span className="az-badge partial">Entrega parcial</span>
                ) : (
                  <span className="az-badge">Comiendo</span>
                )
              ) : (
                <span className="az-badge">Nueva orden</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {account
                ? `Folio A-${String(account.folio).padStart(4, "0")}${account.assignedStaffName ? ` · Mesero: ${account.assignedStaffName}` : ""} · ${formatDateTime(account.openedAt)}`
                : data.table
                  ? `${data.table.sectionName} · ${data.table.seatCount} personas`
                  : "Cuenta nueva"}
            </p>
            {account?.customerName && (
              <p className="text-xs text-[#2a2620] mt-1">
                Cliente: {account.customerName}
                {account.customerPhone ? ` · ${account.customerPhone}` : ""}
              </p>
            )}
          </div>

          {account && account.state !== "closed" && account.state !== "voided" && account.plates.length > 0 ? (
            <PlatesProgressList
              plates={account.plates}
              deliveredUnits={account.deliveredUnits}
              totalUnits={account.totalUnits}
              canDeliver={data.canManageAccount}
              busyItemId={busyItemId}
              busyAll={actionPending}
              onDeliverItem={(orderItemId, qty, dishName) =>
                void handleDeliverItem(orderItemId, qty, dishName)
              }
              onDeliverAllReady={() => void handleDeliverAllReady()}
            />
          ) : (
            account &&
            account.state !== "closed" &&
            account.state !== "voided" &&
            account.progressStep >= 0 && <OrderProgressBar step={account.progressStep} />
          )}

          {account?.state === "awaiting_payment" && (data.canCharge || data.canManageAccount) && (
            <div className="az-notice warn">
              <Receipt className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 grid gap-2">
                {data.canCharge ? (
                  <>
                    <span>
                      {account.reportedPayment
                        ? `${account.reportedPayment.reportedByName} reportó ${formatMoney(account.reportedPayment.receivedCents, data.currencyCode)} en ${PAYMENT_METHOD_LABELS[account.reportedPayment.method]}${account.reportedPayment.tipCents > 0 ? ` (+ ${formatMoney(account.reportedPayment.tipCents, data.currencyCode)} propina)` : ""}. Verifica el pago físico y confirma en Caja.`
                        : "Ya pidieron la cuenta. Registra el cobro (efectivo, tarjeta, mixto o propina) para cerrar la cuenta y liberar la mesa."}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      className="site-button az-coral-cta w-fit"
                      disabled={actionPending}
                      onClick={() => setChargeModalOpen(true)}
                    >
                      <Wallet className="size-4" aria-hidden="true" />
                      {account.reportedPayment
                        ? "Revisar y confirmar cobro"
                        : `Cobrar · ${formatMoney(accountBalanceCents, data.currencyCode)}`}
                    </Button>
                  </>
                ) : account.reportedPayment ? (
                  <>
                    <span>
                      Reportaste{" "}
                      <strong>
                        {formatMoney(account.reportedPayment.receivedCents, data.currencyCode)}
                      </strong>{" "}
                      en {PAYMENT_METHOD_LABELS[account.reportedPayment.method]}. Entrega el pago en
                      Caja para que el cajero lo verifique y confirme el cierre de la cuenta.
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-fit"
                      disabled={actionPending}
                      onClick={() => setReportPaymentOpen(true)}
                    >
                      Actualizar reporte de pago
                    </Button>
                  </>
                ) : (
                  <>
                    <span>
                      Ya pidieron la cuenta. Si el cliente te entrega el pago en mesa, repórtalo a
                      Caja para que el cajero lo verifique y cierre la cuenta.
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-fit"
                      disabled={actionPending}
                      onClick={() => setReportPaymentOpen(true)}
                    >
                      <Receipt className="size-4" aria-hidden="true" />
                      Reportar pago a caja · {formatMoney(accountBalanceCents, data.currencyCode)}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {account?.state === "closed" && (
            <div className="az-notice ok">
              <BadgeCheck className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 grid gap-1">
                <strong>Cuenta cobrada y cerrada</strong>
                <span className="text-xs">
                  {account.closedAt ? `Cerrada el ${formatDateTime(account.closedAt)}` : "Pago completado"}
                </span>
              </div>
              {data.canReopenClosed && (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => setReopenModalOpen(true)}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Reabrir
                </Button>
              )}
            </div>
          )}

          {draft.length === 0 && sentItems.length === 0 && (
            <div className="az-empty !py-6">
              <Utensils className="size-6" aria-hidden="true" />
              <h3>Cuenta sin productos</h3>
              <p className="text-xs">
                Elige del menú lo que pidan. La mesa cambiará a Ocupada en cuanto confirmes{" "}
                <strong>Tomar orden</strong>.
              </p>
            </div>
          )}

          {draft.length > 0 && (
            <div className="grid gap-2">
              <div className="az-section-kicker">Orden por tomar</div>
              <div className="az-lines">
                {draft.map((line) => (
                  <div key={line.key} className="az-line">
                    <div className="az-line-text">
                      <span className="font-semibold text-sm">{line.name}</span>
                      {line.modifiers.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {line.modifiers.map((m) => m.optionName).join(", ")}
                        </span>
                      )}
                      {line.comments && (
                        <span className="text-xs text-muted-foreground">Comentario: {line.comments}</span>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setEditingNoteLine(line)}
                        >
                          <Edit3 className="size-3" aria-hidden="true" />
                          {line.comments ? "Editar comentario" : "Comentario"}
                        </Button>
                        {line.quantity > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => splitDraftLine(line)}
                          >
                            <ArrowLeftRight className="size-3" aria-hidden="true" />
                            Separar una
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="az-line-side">
                      <span className="az-money text-sm">
                        {formatMoney(draftLineTotal(line), data.currencyCode)}
                      </span>
                      <span className="az-stepper">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          aria-label={`Quitar uno de ${line.name}`}
                          onClick={() => adjustDraftQty(line.key, -1)}
                        >
                          <Minus aria-hidden="true" />
                        </Button>
                        <output>{line.quantity}</output>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          aria-label={`Agregar uno de ${line.name}`}
                          onClick={() => adjustDraftQty(line.key, 1)}
                        >
                          <Plus aria-hidden="true" />
                        </Button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="az-totals">
                <div className="font-bold">
                  <span>Total de esta orden</span>
                  <span className="az-money">{formatMoney(draftTotalCents, data.currencyCode)}</span>
                </div>
              </div>
              <Button
                type="button"
                className="site-button az-coral-cta w-full"
                onClick={() => setConfirmSendOpen(true)}
              >
                <Send className="size-4" aria-hidden="true" />
                Tomar orden ({draftCount})
              </Button>
            </div>
          )}

          {sentItems.length > 0 && (
            <div className="grid gap-1">
              <div className="az-section-kicker">Detalle de la cuenta</div>
              <div className="az-lines">
                {sentItems.map((item) => {
                  const canAdjust =
                    data.canManageAccount && account?.state === "open" && item.status === "ordered";
                  return (
                    <div key={item._id} className="az-line">
                      <div className="az-line-text">
                        <span className="text-sm font-medium">
                          {canAdjust ? "" : `${item.quantity} × `}
                          {item.dishName}
                        </span>
                        {item.modifiers.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {item.modifiers.map((m) => m.optionName).join(", ")}
                          </span>
                        )}
                        {item.comments && (
                          <span className="text-xs text-muted-foreground">Comentario: {item.comments}</span>
                        )}
                      </div>
                      <div className="az-line-side">
                        <span className="az-money text-sm">
                          {formatMoney(item.lineTotalCents, data.currencyCode)}
                        </span>
                        {canAdjust ? (
                          <span className="az-stepper">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-xs"
                              aria-label={`Reducir ${item.dishName}`}
                              onClick={async () => {
                                try {
                                  await updateItemQty({
                                    orderItemId: item._id,
                                    quantity: item.quantity - 1,
                                  });
                                } catch (cause) {
                                  showToast(errorMessage(cause), "err");
                                }
                              }}
                            >
                              <Minus aria-hidden="true" />
                            </Button>
                            <output>{item.quantity}</output>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-xs"
                              aria-label={`Aumentar ${item.dishName}`}
                              onClick={async () => {
                                try {
                                  await updateItemQty({
                                    orderItemId: item._id,
                                    quantity: item.quantity + 1,
                                  });
                                } catch (cause) {
                                  showToast(errorMessage(cause), "err");
                                }
                              }}
                            >
                              <Plus aria-hidden="true" />
                            </Button>
                          </span>
                        ) : (
                          data.canManageAccount &&
                          account &&
                          account.state !== "closed" &&
                          account.state !== "voided" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setCancellingItem(item)}
                            >
                              <Ban className="size-3" aria-hidden="true" />
                              Cancelar
                            </Button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {cancelledItems.length > 0 && (
            <div className="grid gap-1">
              <div className="az-section-kicker">Cancelados</div>
              <div className="az-lines">
                {cancelledItems.map((item) => (
                  <div key={item._id} className="az-line opacity-70">
                    <div className="az-line-text">
                      <span className="text-sm font-medium line-through">
                        {item.quantity} × {item.dishName}
                      </span>
                      {item.cancelReason && (
                        <span className="text-xs text-muted-foreground">
                          Motivo: {item.cancelReason}
                        </span>
                      )}
                      <div className="az-cluster mt-1">
                        <span className="az-badge danger">
                          <Ban aria-hidden="true" />
                          Cancelado
                        </span>
                        {item.cancelInventoryAction === "return" && (
                          <span className="az-badge">Insumos devueltos</span>
                        )}
                        {item.cancelInventoryAction === "waste" && (
                          <span className="az-badge warn">Registrado como pérdida</span>
                        )}
                      </div>
                    </div>
                    <span className="az-money text-sm line-through text-muted-foreground">
                      {formatMoney(item.lineTotalCents, data.currencyCode)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {account && account.payments.length > 0 && (
            <div className="grid gap-1">
              <div className="az-section-kicker">Pagos registrados</div>
              <div className="az-lines">
                {account.payments.map((p) => (
                  <div
                    key={p._id}
                    className={`az-line${p.status === "reverted" ? " opacity-60" : ""}`}
                  >
                    <div className="az-line-text">
                      <span className="text-sm font-semibold">
                        {PAYMENT_METHOD_LABELS[p.method]}
                        {p.terminalFolio ? ` · Folio ${p.terminalFolio}` : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {p.createdByName} · {formatDateTime(p.createdAt)}
                        {p.tipCents > 0
                          ? ` · Propina ${formatMoney(p.tipCents, data.currencyCode)}`
                          : ""}
                        {p.changeCents > 0
                          ? ` · Cambio ${formatMoney(p.changeCents, data.currencyCode)}`
                          : ""}
                      </span>
                      {p.status === "reverted" && (
                        <span className="text-xs text-destructive">
                          Revertido{p.revertReason ? `: ${p.revertReason}` : ""}
                        </span>
                      )}
                    </div>
                    <span
                      className={`az-money text-sm${p.status === "reverted" ? " line-through text-muted-foreground" : ""}`}
                    >
                      {formatMoney(p.amountCents, data.currencyCode)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {account && (
            <div className="az-totals">
              {account.discountCents > 0 && (
                <>
                  <div className="text-xs text-muted-foreground">
                    <span>Consumo</span>
                    <span>{formatMoney(accountGrossCents, data.currencyCode)}</span>
                  </div>
                  <div className="text-xs text-[#236a3a]">
                    <span>
                      Descuento
                      {account.discountReason ? ` (${account.discountReason})` : ""}
                    </span>
                    <span>−{formatMoney(account.discountCents, data.currencyCode)}</span>
                  </div>
                </>
              )}
              <div className="text-xs text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatMoney(displaySubtotalCents, data.currencyCode)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                <span>IVA incluido</span>
                <span>{formatMoney(displayTaxCents, data.currencyCode)}</span>
              </div>
              <div className="grand">
                <span>Total</span>
                <span className="az-money">{formatMoney(accountTotalCents, data.currencyCode)}</span>
              </div>
              {(account.paidCents > 0 || account.tipCents > 0) && (
                <>
                  <div className="text-xs text-muted-foreground">
                    <span>Pagado</span>
                    <span className="az-money">
                      {formatMoney(account.paidCents, data.currencyCode)}
                    </span>
                  </div>
                  {account.tipCents > 0 && (
                    <div className="text-xs text-muted-foreground">
                      <span>Propinas (aparte)</span>
                      <span className="az-money">
                        {formatMoney(account.tipCents, data.currencyCode)}
                      </span>
                    </div>
                  )}
                  {account.state !== "closed" && account.state !== "voided" && (
                    <div className="font-bold text-[#9b6011]">
                      <span>Falta por cobrar</span>
                      <span className="az-money">
                        {formatMoney(accountBalanceCents, data.currencyCode)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              {account &&
                account.state === "open" &&
                sentItems.length > 0 &&
                data.canManageAccount && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={actionPending}
                    onClick={handleRequestBillClick}
                  >
                    <Receipt className="size-4" aria-hidden="true" />
                    Pedir la cuenta
                  </Button>
                )}
              {account &&
                (account.state === "open" || account.state === "awaiting_payment") &&
                sentItems.length > 0 &&
                data.canCharge && (
                  <Button
                    type="button"
                    className="site-button az-coral-cta"
                    disabled={actionPending}
                    onClick={() => setChargeModalOpen(true)}
                  >
                    <Wallet className="size-4" aria-hidden="true" />
                    Cobrar
                  </Button>
                )}
              {account &&
                account.state === "awaiting_payment" &&
                !data.canCharge &&
                data.canManageAccount && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={actionPending}
                    onClick={() => setReportPaymentOpen(true)}
                  >
                    <Receipt className="size-4" aria-hidden="true" />
                    {account.reportedPayment ? "Editar reporte" : "Reportar pago"}
                  </Button>
                )}
              {account &&
                account.state !== "closed" &&
                account.state !== "voided" &&
                (data.canManageAccount || data.canCharge) && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setMoreActionsOpen(true)}
                  >
                    <MoreVertical className="size-4" aria-hidden="true" />
                    Más acciones
                  </Button>
                )}
            </div>
            {data.canTakeOrder && (
              <Button
                type="button"
                variant="ghost"
                className="az-only-mobile w-full"
                onClick={() => setMobileTab("menu")}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Volver al menú
              </Button>
            )}
          </div>
        </section>
      </div>

      {pickingDish && (
        <ProductOptionsModal
          dish={pickingDish}
          groups={pickingDish.modifierGroupIds
            .map((gid) => modifierGroupMap.get(gid))
            .filter((g): g is ModifierGroup => Boolean(g))}
          currencyCode={data.currencyCode}
          onClose={() => setPickingDish(null)}
          onAdd={(entries) => {
            addDraftEntries(pickingDish, entries);
            const totalQty = entries.reduce((s, e) => s + e.quantity, 0);
            showToast(`${totalQty} × ${pickingDish.name} en la orden`);
            setPickingDish(null);
          }}
        />
      )}

      {editingNoteLine && (
        <NoteModal
          line={editingNoteLine}
          onClose={() => setEditingNoteLine(null)}
          onSave={(comments) => {
            setDraft((prev) =>
              prev.map((l) => (l.key === editingNoteLine.key ? { ...l, comments } : l)),
            );
            setEditingNoteLine(null);
          }}
        />
      )}

      {confirmSendOpen && (
        <AdminModal
          title="¿Confirmas la orden?"
          onClose={() => setConfirmSendOpen(false)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={actionPending} onClick={() => setConfirmSendOpen(false)}>
                Seguir editando
              </Button>
              <Button
                type="button"
                className="site-button az-coral-cta"
                disabled={actionPending}
                onClick={() => void handleConfirmOrder()}
              >
                <Send className="size-4" aria-hidden="true" />
                {actionPending ? "Enviando…" : "Sí, mandar a cocina"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            Revísala con el cliente. Al confirmar, la orden se envía a sus áreas de preparación y la mesa queda marcada
            como ocupada.
          </p>
          <div className="az-lines">
            {draft.map((line) => (
              <div key={line.key} className="az-line">
                <div className="az-line-text">
                  <strong className="text-sm">
                    {line.quantity} × {line.name}
                  </strong>
                  {line.modifiers.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {line.modifiers.map((m) => m.optionName).join(", ")}
                    </span>
                  )}
                  {line.comments && (
                    <span className="text-xs text-muted-foreground">Comentario: {line.comments}</span>
                  )}
                </div>
                <span className="az-money text-sm">
                  {formatMoney(draftLineTotal(line), data.currencyCode)}
                </span>
              </div>
            ))}
          </div>
          <div className="az-totals">
            <div className="grand">
              <span>Total de esta orden</span>
              <span className="az-money">{formatMoney(draftTotalCents, data.currencyCode)}</span>
            </div>
          </div>
        </AdminModal>
      )}

      {moreActionsOpen && account && (
        <AdminModal title="Más acciones" onClose={() => setMoreActionsOpen(false)}>
          <div className="grid gap-2">
            {data.canCharge && sentItems.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                disabled={actionPending}
                onClick={() => {
                  setMoreActionsOpen(false);
                  setDiscountModalOpen(true);
                }}
              >
                <Percent className="size-4" aria-hidden="true" />
                {account.discountCents > 0 ? "Editar o quitar descuento" : "Aplicar descuento o cortesía"}
              </Button>
            )}
            {account.state === "open" && sentItems.length > 0 && !data.canCharge && data.canManageAccount && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                disabled={actionPending}
                onClick={() => {
                  setMoreActionsOpen(false);
                  setReportPaymentOpen(true);
                }}
              >
                <Receipt className="size-4" aria-hidden="true" />
                Reportar pago a caja
              </Button>
            )}
            {account.hasUndelivered && data.canManageAccount && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                disabled={actionPending}
                onClick={() => void handleMarkDelivered()}
              >
                <Check className="size-4" aria-hidden="true" />
                Marcar todo como entregado
              </Button>
            )}
            {account.kind === "dine_in" && data.freeTables.length > 0 && data.canManageAccount && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => {
                  setMoreActionsOpen(false);
                  setMoveModalOpen(true);
                }}
              >
                <ArrowLeftRight className="size-4" aria-hidden="true" />
                Mover a otra mesa
              </Button>
            )}
            {data.activeWaiters.length > 0 && data.canManageAccount && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => {
                  setMoreActionsOpen(false);
                  setReassignModalOpen(true);
                }}
              >
                <UserCheck className="size-4" aria-hidden="true" />
                Reasignar mesero
              </Button>
            )}
            {account.state === "awaiting_payment" && data.canManageAccount && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                disabled={actionPending}
                onClick={() => void handleReopenOrdering()}
              >
                <Undo2 className="size-4" aria-hidden="true" />
                Volver a tomar orden
              </Button>
            )}
            {account.state === "open" && sentItems.length === 0 && data.canManageAccount && (
              <Button
                type="button"
                variant="destructive"
                className="justify-start"
                onClick={() => {
                  setMoreActionsOpen(false);
                  setVoidConfirmOpen(true);
                }}
              >
                <Ban className="size-4" aria-hidden="true" />
                Anular cuenta vacía
              </Button>
            )}
          </div>
        </AdminModal>
      )}

      {moveModalOpen && account && (
        <MoveTableModal
          tableLabel={accountTitle}
          freeTables={data.freeTables}
          onClose={() => setMoveModalOpen(false)}
          onMove={async (targetTableId) => {
            await moveAccountToTable({ accountId: account._id, targetTableId });
            setMoveModalOpen(false);
            showToast("Cuenta movida de mesa");
          }}
        />
      )}

      {cancellingItem && (
        <CancelItemModal
          item={cancellingItem}
          onClose={() => setCancellingItem(null)}
          onConfirm={async (reason, inventoryAction) => {
            const res = await cancelOrderItem({
              orderItemId: cancellingItem._id,
              reason,
              inventoryAction,
            });
            setCancellingItem(null);
            showToast(
              res.notifiedKitchen
                ? `${cancellingItem.dishName} cancelado. Estación avisada para no prepararlo.`
                : `${cancellingItem.dishName} cancelado.`,
            );
          }}
        />
      )}

      {reassignModalOpen && account && (
        <ReassignWaiterModal
          currentWaiterId={account.assignedStaffId}
          waiters={data.activeWaiters}
          onClose={() => setReassignModalOpen(false)}
          onReassign={async (targetStaffId) => {
            const res = await reassignWaiter({ accountId: account._id, targetStaffId });
            setReassignModalOpen(false);
            showToast(`Ahora atiende ${res.assignedStaffName}`);
          }}
        />
      )}

      {billWarningOpen && account && (
        <ConfirmModal
          title="Hay platillos sin entregar"
          message={`Todavía quedan ${Math.max(0, account.totalUnits - account.deliveredUnits)} de ${account.totalUnits} platillos sin entregar en ${accountTitle}. ¿Seguro que quieres pedir la cuenta ahora?`}
          confirmLabel="Sí, pedir la cuenta"
          pending={actionPending}
          onConfirm={() => void executeRequestBill()}
          onClose={() => setBillWarningOpen(false)}
        />
      )}

      {leaveDraftOpen && (
        <AdminModal
          title="Tienes una orden sin confirmar"
          onClose={() => setLeaveDraftOpen(false)}
          footer={
            <>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setDraft([]);
                  saveStoredDraft(storageId, []);
                  setLeaveDraftOpen(false);
                  router.push(returnHref);
                }}
              >
                Descartar y salir
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  saveStoredDraft(storageId, draft);
                  setLeaveDraftOpen(false);
                  router.push(returnHref);
                }}
              >
                Guardar borrador y salir
              </Button>
              <Button
                type="button"
                className="site-button"
                onClick={() => setLeaveDraftOpen(false)}
              >
                Seguir editando
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            Agregaste <strong>{draftCount}</strong> {draftCount === 1 ? "producto" : "productos"} que todavía no se
            envían a preparación. Puedes guardar el borrador para retomarlo después desde Mis mesas, o descartarlo.
          </p>
        </AdminModal>
      )}

      {reportPaymentOpen && account && (
        <ReportPaymentModal
          target={{
            accountId: account._id,
            folio: account.folio,
            label: accountTitle,
            balanceCents: account.balanceCents,
            existingReport: account.reportedPayment,
          }}
          currencyCode={data.currencyCode}
          onClose={() => setReportPaymentOpen(false)}
          onReported={(msg) => {
            setReportPaymentOpen(false);
            showToast(msg);
          }}
        />
      )}

      {chargeModalOpen && account && (
        <ChargeModal
          target={{
            accountId: account._id,
            folio: account.folio,
            label: accountTitle,
            totalCents: account.totalCents,
            discountCents: account.discountCents,
            paidCents: account.paidCents,
            balanceCents: account.balanceCents,
            reportedPayment: account.reportedPayment,
          }}
          currencyCode={data.currencyCode}
          hasOpenShift={data.hasOpenShift}
          onClose={() => setChargeModalOpen(false)}
          onCompleted={({ closed }) => {
            showToast(closed ? "Cuenta cobrada y cerrada" : "Abono registrado");
          }}
        />
      )}

      {discountModalOpen && account && (
        <DiscountModal
          accountId={account._id}
          grossCents={accountGrossCents}
          currentKind={account.discountKind}
          currentValue={account.discountValue}
          currentReason={account.discountReason}
          currencyCode={data.currencyCode}
          onClose={() => setDiscountModalOpen(false)}
          onApplied={(msg) => {
            setDiscountModalOpen(false);
            showToast(msg);
          }}
        />
      )}

      {reopenModalOpen && account && (
        <ReopenAccountModal
          accountId={account._id}
          folio={account.folio}
          label={accountTitle}
          onClose={() => setReopenModalOpen(false)}
          onReopened={(msg) => {
            setReopenModalOpen(false);
            showToast(msg);
          }}
        />
      )}

      {voidConfirmOpen && account && (
        <ConfirmModal
          title="Anular cuenta"
          message={`La cuenta A-${String(account.folio).padStart(4, "0")} no tiene productos. Se anulará y la mesa quedará libre.`}
          confirmLabel="Anular cuenta"
          danger
          pending={actionPending}
          onConfirm={() => void handleVoidAccount()}
          onClose={() => setVoidConfirmOpen(false)}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}

function ProductOptionsModal({
  dish,
  groups,
  currencyCode,
  onClose,
  onAdd,
}: {
  dish: MenuDish;
  groups: ModifierGroup[];
  currencyCode: string;
  onClose: () => void;
  onAdd: (entries: Array<{ quantity: number; comments: string; modifiers: DraftModifier[] }>) => void;
}) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState<string[]>([""]);
  const [selected, setSelected] = useState<Record<string, Id<"modifierOptions">[]>>({});
  const [error, setError] = useState<string | null>(null);

  function pickOption(group: ModifierGroup, optId: Id<"modifierOptions">) {
    setError(null);
    setSelected((prev) => {
      const cur = prev[group._id] ?? [];
      if (group.multi) {
        return {
          ...prev,
          [group._id]: cur.includes(optId) ? cur.filter((id) => id !== optId) : [...cur, optId],
        };
      }
      return { ...prev, [group._id]: [optId] };
    });
  }

  function changeQty(next: number) {
    const clamped = Math.max(1, Math.min(20, next));
    setQty(clamped);
    setNotes((prev) => {
      if (clamped > prev.length) return [...prev, ...Array(clamped - prev.length).fill("")];
      return prev.slice(0, clamped);
    });
  }

  const extraCents = groups.reduce((sum, g) => {
    const picked = selected[g._id] ?? [];
    return (
      sum +
      g.options
        .filter((o) => picked.includes(o._id))
        .reduce((s, o) => s + o.priceExtraCents, 0)
    );
  }, 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    for (const group of groups) {
      if (group.required && !(selected[group._id]?.length > 0)) {
        setError(`Elige una opción de ${group.name.toLowerCase()} para continuar.`);
        return;
      }
    }
    const modifiers: DraftModifier[] = [];
    for (const group of groups) {
      const picked = selected[group._id] ?? [];
      for (const opt of group.options) {
        if (picked.includes(opt._id)) {
          modifiers.push({
            optionId: opt._id,
            groupName: group.name,
            optionName: opt.name,
            priceExtraCents: opt.priceExtraCents,
          });
        }
      }
    }
    // Group identical comments together; distinct comments become separate order lines.
    const grouped: Array<{ comments: string; quantity: number; modifiers: DraftModifier[] }> = [];
    for (const raw of notes) {
      const comments = raw.trim();
      const match = grouped.find((item) => item.comments === comments);
      if (match) match.quantity += 1;
      else grouped.push({ comments, quantity: 1, modifiers });
    }
    onAdd(grouped);
  }

  return (
    <AdminModal
      title={dish.name}
      onClose={onClose}
      footer={
        <Button type="submit" form="pick-dish-form" className="site-button az-coral-cta w-full">
          Agregar · {formatMoney((dish.priceCents + extraCents) * qty, currencyCode)}
        </Button>
      }
    >
      <form id="pick-dish-form" className="grid gap-4" onSubmit={submit}>
        {dish.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dish.photoUrl}
            alt={dish.name}
            className="w-full max-h-56 object-cover rounded-xl border border-[#ddd2b6]"
          />
        )}
        {dish.description && <p className="text-sm text-muted-foreground">{dish.description}</p>}
        <p className="az-money text-base">{formatMoney(dish.priceCents, currencyCode)}</p>

        {groups.map((group) => (
          <fieldset key={group._id} className="grid gap-2">
            <legend className="font-heading text-sm font-bold mb-1">
              {group.name}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {group.required ? "(obligatorio)" : group.multi ? "(opcional, varias)" : "(opcional)"}
              </span>
            </legend>
            {group.options.map((opt) => {
              const checked = (selected[group._id] ?? []).includes(opt._id);
              return (
                <label key={opt._id} className={`az-opt${checked ? " on" : ""}`}>
                  <input
                    type={group.multi ? "checkbox" : "radio"}
                    name={`group-${group._id}`}
                    checked={checked}
                    onChange={() => pickOption(group, opt._id)}
                  />
                  <span className="flex-1 text-sm">{opt.name}</span>
                  {opt.priceExtraCents > 0 && (
                    <span className="az-money text-xs">
                      +{formatMoney(opt.priceExtraCents, currencyCode)}
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>
        ))}

        <div className="flex items-center justify-between gap-3">
          <span className="font-heading text-sm font-bold">Cantidad</span>
          <span className="az-stepper">
            <Button type="button" variant="outline" size="icon-sm" aria-label="Quitar uno" onClick={() => changeQty(qty - 1)}>
              <Minus aria-hidden="true" />
            </Button>
            <output>{qty}</output>
            <Button type="button" variant="outline" size="icon-sm" aria-label="Agregar uno" onClick={() => changeQty(qty + 1)}>
              <Plus aria-hidden="true" />
            </Button>
          </span>
        </div>

        {qty === 1 ? (
          <div className="az-field">
            <label htmlFor="dish-note-0">Comentario (opcional)</label>
            <input
              id="dish-note-0"
              value={notes[0] ?? ""}
              onChange={(e) => setNotes([e.target.value])}
              placeholder="Por ejemplo, sin cilantro"
              maxLength={140}
            />
          </div>
        ) : (
          <div className="grid gap-2">
            <div>
              <span className="font-heading text-sm font-bold">Comentario de cada orden</span>
              <p className="text-xs text-muted-foreground">
                Si una va distinta, escríbelo solo en esa y saldrá como línea separada.
              </p>
            </div>
            {notes.map((val, idx) => (
              <div key={idx} className="az-field">
                <label htmlFor={`dish-note-${idx}`}>Orden {idx + 1}</label>
                <input
                  id={`dish-note-${idx}`}
                  value={val}
                  onChange={(e) =>
                    setNotes((prev) => prev.map((item, i) => (i === idx ? e.target.value : item)))
                  }
                  placeholder="Sin cambios"
                  maxLength={140}
                />
              </div>
            ))}
          </div>
        )}

        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}

function NoteModal({
  line,
  onClose,
  onSave,
}: {
  line: DraftLine;
  onClose: () => void;
  onSave: (comments: string) => void;
}) {
  const [text, setText] = useState(line.comments);
  return (
    <AdminModal
      title="Comentario de la orden"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="note-form"
            className="site-button"
          >
            Guardar
          </Button>
        </>
      }
    >
      <form
        id="note-form"
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(text.trim());
        }}
      >
        <p className="text-sm text-muted-foreground">
          {line.quantity} × {line.name}
        </p>
        <div className="az-field">
          <label htmlFor="line-note-input">Comentario</label>
          <input
            id="line-note-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Sin cebolla, salsa aparte…"
            maxLength={140}
            autoFocus
          />
        </div>
      </form>
    </AdminModal>
  );
}

function MoveTableModal({
  tableLabel,
  freeTables,
  onClose,
  onMove,
}: {
  tableLabel: string;
  freeTables: Array<{ _id: Id<"diningTables">; tableNumber: string; sectionName: string }>;
  onClose: () => void;
  onMove: (targetTableId: Id<"diningTables">) => Promise<void>;
}) {
  const [targetId, setTargetId] = useState<string>(freeTables[0]?._id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!targetId) return;
    setPending(true);
    setError(null);
    try {
      await onMove(targetId as Id<"diningTables">);
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos mover la cuenta."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={`Mover ${tableLabel}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="move-table-form" className="site-button" disabled={pending}>
            {pending ? "Moviendo…" : "Mover cuenta"}
          </Button>
        </>
      }
    >
      <form id="move-table-form" className="grid gap-3" onSubmit={submit}>
        <div className="az-field">
          <label htmlFor="move-target">Mesa libre</label>
          <select id="move-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {freeTables.map((t) => (
              <option key={t._id} value={t._id}>
                {t.tableNumber} · {t.sectionName}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          La mesa de origen quedará libre y la cuenta conservará todos sus productos.
        </p>
        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}

function CancelItemModal({
  item,
  onClose,
  onConfirm,
}: {
  item: AccountItem;
  onClose: () => void;
  onConfirm: (reason: string, inventoryAction: "none" | "return" | "waste") => Promise<void>;
}) {
  const consumed = item.inventoryConsumedQuantity > 0;
  const [reason, setReason] = useState("");
  const [inventoryAction, setInventoryAction] = useState<"none" | "return" | "waste">(
    consumed ? "return" : "none",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Escribe el motivo de la cancelación.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason.trim(), consumed ? inventoryAction : "none");
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos cancelar el platillo."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={`Cancelar ${item.quantity} × ${item.dishName}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Conservar platillo
          </Button>
          <Button type="submit" form="cancel-item-form" variant="destructive" disabled={pending}>
            {pending ? "Cancelando…" : "Cancelar platillo"}
          </Button>
        </>
      }
    >
      <form id="cancel-item-form" className="grid gap-4" onSubmit={submit}>
        <p className="text-sm text-muted-foreground">
          {consumed
            ? "La estación ya empezó a prepararlo. Aparecerá tachado como NO PREPARAR en su pantalla para que lo detengan."
            : "Todavía no se empieza a preparar, así que no afectará el inventario."}
        </p>
        <div className="az-field">
          <label htmlFor="cancel-reason">Motivo (obligatorio)</label>
          <input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={160}
            placeholder="Por ejemplo, el comensal cambió de opinión"
            autoFocus
            required
          />
        </div>
        {consumed && (
          <fieldset className="grid gap-2">
            <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              ¿Qué pasa con los insumos ya descontados?
            </legend>
            <label className={`az-opt${inventoryAction === "return" ? " on" : ""}`}>
              <input
                type="radio"
                name="cancel-inv"
                checked={inventoryAction === "return"}
                onChange={() => setInventoryAction("return")}
              />
              <span className="text-sm">No se usaron · los insumos regresan al inventario</span>
            </label>
            <label className={`az-opt${inventoryAction === "waste" ? " on" : ""}`}>
              <input
                type="radio"
                name="cancel-inv"
                checked={inventoryAction === "waste"}
                onChange={() => setInventoryAction("waste")}
              />
              <span className="text-sm">Se registra como pérdida por lo ya preparado</span>
            </label>
          </fieldset>
        )}
        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}

function ReassignWaiterModal({
  currentWaiterId,
  waiters,
  onClose,
  onReassign,
}: {
  currentWaiterId: Id<"staff"> | null;
  waiters: Array<{ _id: Id<"staff">; displayName: string }>;
  onClose: () => void;
  onReassign: (targetStaffId: Id<"staff">) => Promise<void>;
}) {
  const [targetId, setTargetId] = useState<string>(
    waiters.find((w) => w._id !== currentWaiterId)?._id ?? waiters[0]?._id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!targetId) return;
    setPending(true);
    setError(null);
    try {
      await onReassign(targetId as Id<"staff">);
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos reasignar el mesero."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title="Reasignar mesero"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="reassign-waiter-form" className="site-button" disabled={pending || !targetId}>
            {pending ? "Reasignando…" : "Reasignar"}
          </Button>
        </>
      }
    >
      <form id="reassign-waiter-form" className="grid gap-3" onSubmit={submit}>
        <div className="az-field">
          <label htmlFor="reassign-target">Mesero a cargo</label>
          <select id="reassign-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {waiters.map((w) => (
              <option key={w._id} value={w._id}>
                {w.displayName}
                {w._id === currentWaiterId ? " (actual)" : ""}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          La cuenta y los avisos de esta mesa pasarán al mesero seleccionado.
        </p>
        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}
