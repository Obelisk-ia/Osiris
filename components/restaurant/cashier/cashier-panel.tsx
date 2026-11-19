"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BadgeCheck,
  Calculator,
  Check,
  Clock,
  ExternalLink,
  Info,
  PackageX,
  Receipt,
  RotateCcw,
  Search,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AdminModal,
  AdminPageHead,
  EmptyState,
  ToastBanner,
  useToast,
} from "@/components/restaurant/admin/admin-ui";
import { Button } from "@/components/ui/button";
import {
  errorMessage,
  formatDateTime,
  formatMoney,
  parseMoneyCents,
} from "@/lib/format";
import {
  ChargeModal,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  ReopenAccountModal,
  type ChargeTarget,
  type PaymentMethodValue,
} from "./charge-modal";

type Snapshot = NonNullable<ReturnType<typeof usePreloadedQuery<typeof api.cashier.snapshot>>>;
type PastShift = Snapshot["pastShifts"][number];
type ClosedAccount = Snapshot["closedAccounts"][number];

type CajaTab = "cobrar" | "turno" | "cobradas" | "agotados";

export function CashierPanel({
  preloaded,
  pageIndex = 1,
  pageTotal = 3,
}: {
  preloaded: Preloaded<typeof api.cashier.snapshot>;
  pageIndex?: number;
  pageTotal?: number;
}) {
  const data = usePreloadedQuery(preloaded);
  const { toast, showToast } = useToast();

  const openShift = useMutation(api.cashier.openShift);
  const recordCashMovement = useMutation(api.cashier.recordCashMovement);
  const closeShift = useMutation(api.cashier.closeShift);
  const toggleDishSoldOut = useMutation(api.cashier.toggleDishSoldOut);

  const [tab, setTab] = useState<CajaTab>("cobrar");
  const [closedSearch, setClosedSearch] = useState("");
  const [dishSearch, setDishSearch] = useState("");

  const [chargeTarget, setChargeTarget] = useState<ChargeTarget | null>(null);
  const [reopenTarget, setReopenTarget] = useState<ClosedAccount | null>(null);
  const [openShiftModal, setOpenShiftModal] = useState(false);
  const [movementModal, setMovementModal] = useState<"ingreso" | "retiro" | null>(null);
  const [cutModalOpen, setCutModalOpen] = useState(false);
  const [viewingPastCut, setViewingPastCut] = useState<PastShift | null>(null);
  const [togglingDishId, setTogglingDishId] = useState<Id<"dishes"> | null>(null);

  const readyBalanceCents = data.readyAccounts.reduce((sum, a) => sum + a.balanceCents, 0);
  const openBalanceCents = data.openAccounts.reduce((sum, a) => sum + a.balanceCents, 0);

  const filteredClosed = useMemo(() => {
    const q = closedSearch.trim().toLowerCase();
    if (!q) return data.closedAccounts;
    return data.closedAccounts.filter((acc) => {
      const folioStr = `a-${String(acc.folio).padStart(4, "0")}`;
      const methodsStr = acc.methods.map((m) => PAYMENT_METHOD_LABELS[m].toLowerCase()).join(" ");
      return (
        acc.label.toLowerCase().includes(q) ||
        folioStr.includes(q) ||
        (acc.customerName ?? "").toLowerCase().includes(q) ||
        (acc.assignedStaffName ?? "").toLowerCase().includes(q) ||
        methodsStr.includes(q)
      );
    });
  }, [data.closedAccounts, closedSearch]);

  const closedTotalCents = filteredClosed.reduce((sum, a) => sum + a.totalCents, 0);
  const closedTipsCents = filteredClosed.reduce((sum, a) => sum + a.tipCents, 0);

  const filteredDishes = useMemo(() => {
    const q = dishSearch.trim().toLowerCase();
    if (!q) return data.dishes;
    return data.dishes.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.categoryName.toLowerCase().includes(q),
    );
  }, [data.dishes, dishSearch]);

  const soldOutCount = data.dishes.filter((d) => d.soldOut).length;

  async function handleToggleDish(dishId: Id<"dishes">, nextAvailable: boolean, name: string) {
    setTogglingDishId(dishId);
    try {
      await toggleDishSoldOut({ dishId, isAvailable: nextAvailable });
      showToast(nextAvailable ? `${name} disponible de nuevo` : `${name} marcado como agotado`);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos actualizar la disponibilidad."), "err");
    } finally {
      setTogglingDishId(null);
    }
  }

  return (
    <div className="az-page">
      <AdminPageHead
        index={pageIndex}
        total={pageTotal}
        restaurantName={data.restaurantName}
        locationName={data.locationName}
        title="Caja y cobros"
        subtitle="Cobra cuentas con métodos mixtos y propinas, lleva tu turno de efectivo y consulta cortes e historial."
        actions={
          data.activeShift ? (
            <Button variant="outline" onClick={() => setTab("turno")}>
              <Calculator className="size-4" aria-hidden="true" />
              Turno abierto · {formatMoney(data.activeShift.expectedCashCents, data.currencyCode)}
            </Button>
          ) : (
            <Button className="site-button" onClick={() => setOpenShiftModal(true)}>
              <Wallet className="size-4" aria-hidden="true" />
              Abrir turno
            </Button>
          )
        }
      />

      <div className="az-tabs" role="tablist" aria-label="Secciones de caja">
        <button
          type="button"
          role="tab"
          className="az-tab"
          aria-selected={tab === "cobrar"}
          onClick={() => setTab("cobrar")}
        >
          <span>Cobrar</span>
          {data.readyAccounts.length > 0 && (
            <span className="az-count">{data.readyAccounts.length}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          className="az-tab"
          aria-selected={tab === "turno"}
          onClick={() => setTab("turno")}
        >
          <span>Turno y corte</span>
          {data.activeShift && <span className="az-badge success">Abierto</span>}
        </button>
        <button
          type="button"
          role="tab"
          className="az-tab"
          aria-selected={tab === "cobradas"}
          onClick={() => setTab("cobradas")}
        >
          <span>Ya cobradas</span>
          {data.closedAccounts.length > 0 && (
            <span className="az-badge">{data.closedAccounts.length}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          className="az-tab"
          aria-selected={tab === "agotados"}
          onClick={() => setTab("agotados")}
        >
          <span>Agotados</span>
          {soldOutCount > 0 && <span className="az-badge warn">{soldOutCount}</span>}
        </button>
      </div>

      {tab === "cobrar" && (
        <div className="grid gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="az-card !p-4 !gap-1">
              <span className="text-xs font-semibold text-muted-foreground">
                Listas para cobrar
              </span>
              <strong className="font-heading text-3xl font-extrabold tracking-tight">
                {data.readyAccounts.length}
              </strong>
              <span className="text-xs text-muted-foreground">
                {data.readyAccounts.length === 1 ? "cuenta esperando cobro" : "cuentas esperando cobro"}
              </span>
            </div>
            <div className="az-card !p-4 !gap-1">
              <span className="text-xs font-semibold text-muted-foreground">
                Falta cobrar en esas cuentas
              </span>
              <strong className="font-heading text-3xl font-extrabold tracking-tight az-money">
                {formatMoney(readyBalanceCents, data.currencyCode)}
              </strong>
              <span className="text-xs text-muted-foreground">Saldo pendiente por liquidar</span>
            </div>
            <div className="az-card !p-4 !gap-1">
              <span className="text-xs font-semibold text-muted-foreground">
                Todavía en consumo
              </span>
              <strong className="font-heading text-3xl font-extrabold tracking-tight">
                {data.openAccounts.length}
              </strong>
              <span className="text-xs text-muted-foreground">
                {formatMoney(openBalanceCents, data.currencyCode)} acumulado
              </span>
            </div>
          </div>

          {!data.activeShift && (
            <div className="az-notice">
              <Info className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
                <span>
                  Puedes cobrar en cualquier momento sin turno abierto, o abrir un turno con fondo
                  inicial para llevar tu corte de efectivo.
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => setOpenShiftModal(true)}
                >
                  Abrir turno
                </Button>
              </div>
            </div>
          )}

          <section className="grid gap-3" aria-label="Cuentas listas para cobrar">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-heading text-xl font-bold tracking-tight">
                Listas para cobrar
              </h2>
              {data.readyAccounts.length > 0 && (
                <span className="az-badge warn">{data.readyAccounts.length} por cobrar</span>
              )}
            </div>

            {data.readyAccounts.length > 0 ? (
              <ul className="az-rows">
                {data.readyAccounts.map((acc) => (
                  <li key={acc._id}>
                    <div className="az-row-main">
                      <div className="az-row-text">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="font-heading text-lg font-bold">{acc.label}</strong>
                          {acc.reportedPayment ? (
                            <span className="az-badge accent">
                              <BadgeCheck aria-hidden="true" />
                              Pago reportado por {acc.reportedPayment.reportedByName}
                            </span>
                          ) : (
                            <span className="az-badge warn">
                              <Receipt aria-hidden="true" />
                              Pidió la cuenta
                            </span>
                          )}
                          {acc.paidCents > 0 && (
                            <span className="az-badge accent">Abono parcial</span>
                          )}
                          {acc.discountCents > 0 && (
                            <span className="az-badge">Con descuento</span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Folio A-{String(acc.folio).padStart(4, "0")}
                          {acc.sectionName ? ` · ${acc.sectionName}` : ""}
                          {acc.assignedStaffName ? ` · Mesero: ${acc.assignedStaffName}` : ""}
                          {acc.billRequestedAt
                            ? ` · Pidió cuenta ${formatDateTime(acc.billRequestedAt)}`
                            : ""}
                        </span>
                        {acc.reportedPayment && (
                          <span className="text-xs font-medium text-[#7a261a]">
                            Reportado: {formatMoney(acc.reportedPayment.receivedCents, data.currencyCode)}{" "}
                            en {PAYMENT_METHOD_LABELS[acc.reportedPayment.method]}
                            {acc.reportedPayment.tipCents > 0
                              ? ` + ${formatMoney(acc.reportedPayment.tipCents, data.currencyCode)} propina`
                              : ""}
                            {acc.reportedPayment.terminalFolio
                              ? ` · Folio ${acc.reportedPayment.terminalFolio}`
                              : ""}
                            {acc.reportedPayment.note ? ` · "${acc.reportedPayment.note}"` : ""}
                          </span>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-xs pt-0.5">
                          <span>
                            Total:{" "}
                            <strong className="az-money">
                              {formatMoney(acc.totalCents, data.currencyCode)}
                            </strong>
                          </span>
                          {acc.paidCents > 0 && (
                            <span className="text-muted-foreground">
                              Pagado:{" "}
                              <strong className="az-money">
                                {formatMoney(acc.paidCents, data.currencyCode)}
                              </strong>
                            </span>
                          )}
                          <span className="font-semibold text-foreground">
                            Falta:{" "}
                            <strong className="az-money">
                              {formatMoney(acc.balanceCents, data.currencyCode)}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div className="az-row-actions">
                        <Link
                          href={`/cuenta/mesero/cuenta/${acc._id}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs font-semibold hover:border-foreground"
                        >
                          Ver cuenta
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                        </Link>
                        <Button
                          type="button"
                          size="sm"
                          className="site-button az-coral-cta !min-h-[38px] !py-1.5 !px-4"
                          onClick={() =>
                            setChargeTarget({
                              accountId: acc._id,
                              folio: acc.folio,
                              label: acc.label,
                              totalCents: acc.totalCents,
                              discountCents: acc.discountCents,
                              paidCents: acc.paidCents,
                              balanceCents: acc.balanceCents,
                              reportedPayment: acc.reportedPayment,
                            })
                          }
                        >
                          <Wallet className="size-3.5" aria-hidden="true" />
                          {acc.reportedPayment
                            ? "Revisar y confirmar"
                            : `Cobrar ${formatMoney(acc.balanceCents, data.currencyCode)}`}
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<Receipt className="size-7" aria-hidden="true" />}
                title="No hay cuentas esperando cobro"
                description="Cuando un mesero presione Pedir la cuenta, la mesa aparecerá aquí al instante."
              />
            )}
          </section>

          {data.openAccounts.length > 0 && (
            <section className="grid gap-3" aria-label="Cuentas todavía comiendo">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-heading text-xl font-bold tracking-tight">
                  Todavía comiendo
                </h2>
                <span className="text-xs text-muted-foreground">
                  Si el cliente pasa directo a caja, puedes cobrar aquí
                </span>
              </div>

              <ul className="az-rows">
                {data.openAccounts.map((acc) => (
                  <li key={acc._id}>
                    <div className="az-row-main">
                      <div className="az-row-text">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="font-heading text-base font-bold">{acc.label}</strong>
                          <span className="az-badge">Abierta</span>
                          {acc.hasUndelivered && (
                            <span className="az-badge">Con platillos en proceso</span>
                          )}
                          {acc.paidCents > 0 && (
                            <span className="az-badge accent">
                              Abonado {formatMoney(acc.paidCents, data.currencyCode)}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Folio A-{String(acc.folio).padStart(4, "0")} · {acc.itemCount}{" "}
                          {acc.itemCount === 1 ? "producto" : "productos"}
                          {acc.assignedStaffName ? ` · Mesero: ${acc.assignedStaffName}` : ""}
                        </span>
                      </div>
                      <div className="az-row-actions">
                        <strong className="az-money text-sm mr-1">
                          {formatMoney(acc.balanceCents, data.currencyCode)}
                        </strong>
                        <Link
                          href={`/cuenta/mesero/cuenta/${acc._id}`}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:border-foreground"
                        >
                          Ver
                        </Link>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            setChargeTarget({
                              accountId: acc._id,
                              folio: acc.folio,
                              label: acc.label,
                              totalCents: acc.totalCents,
                              discountCents: acc.discountCents,
                              paidCents: acc.paidCents,
                              balanceCents: acc.balanceCents,
                            })
                          }
                        >
                          Cobrar
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === "turno" && (
        <div className="grid gap-6">
          {data.activeShift ? (
            <>
              <div className="az-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="az-badge success">
                        <Check aria-hidden="true" />
                        Turno abierto
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Desde {formatDateTime(data.activeShift.openedAt)}
                      </span>
                    </div>
                    <h2 className="font-heading text-2xl font-extrabold tracking-tight mt-2">
                      Caja a cargo de {data.activeShift.cashierName}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Fondo inicial: {formatMoney(data.activeShift.fundCents, data.currencyCode)} ·{" "}
                      {data.activeShift.paymentCount}{" "}
                      {data.activeShift.paymentCount === 1 ? "pago registrado" : "pagos registrados"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMovementModal("ingreso")}
                    >
                      <ArrowDownCircle className="size-4" aria-hidden="true" />
                      Registrar ingreso
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMovementModal("retiro")}
                    >
                      <ArrowUpCircle className="size-4" aria-hidden="true" />
                      Registrar retiro
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="site-button az-coral-cta !min-h-[38px]"
                      onClick={() => setCutModalOpen(true)}
                    >
                      <Calculator className="size-4" aria-hidden="true" />
                      Hacer corte y cerrar turno
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                  <div className="rounded-xl border border-[#ddd2b6] bg-[#faf5e7] p-3.5 grid gap-1">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Efectivo esperado en caja
                    </span>
                    <strong className="font-heading text-2xl font-extrabold az-money">
                      {formatMoney(data.activeShift.expectedCashCents, data.currencyCode)}
                    </strong>
                    <span className="text-[11px] text-muted-foreground">
                      Fondo + efectivo + prop. efvo + ingresos − retiros
                    </span>
                  </div>
                  <div className="rounded-xl border border-[#ddd2b6] bg-[#faf5e7] p-3.5 grid gap-1">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Ventas del turno
                    </span>
                    <strong className="font-heading text-2xl font-extrabold az-money">
                      {formatMoney(data.activeShift.salesCents, data.currencyCode)}
                    </strong>
                    <span className="text-[11px] text-muted-foreground">
                      Todos los métodos (sin propinas)
                    </span>
                  </div>
                  <div className="rounded-xl border border-[#ddd2b6] bg-[#faf5e7] p-3.5 grid gap-1">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Propinas (aparte)
                    </span>
                    <strong className="font-heading text-2xl font-extrabold az-money">
                      {formatMoney(data.activeShift.tipsCents, data.currencyCode)}
                    </strong>
                    <span className="text-[11px] text-muted-foreground">
                      En efectivo: {formatMoney(data.activeShift.cashTipsCents, data.currencyCode)}
                    </span>
                  </div>
                  <div className="rounded-xl border border-[#ddd2b6] bg-[#faf5e7] p-3.5 grid gap-1">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Ingresos / Retiros
                    </span>
                    <strong className="font-heading text-lg font-extrabold az-money">
                      +{formatMoney(data.activeShift.insCents, data.currencyCode)} / −
                      {formatMoney(data.activeShift.outsCents, data.currencyCode)}
                    </strong>
                    <span className="text-[11px] text-muted-foreground">
                      {data.activeShift.movements.length}{" "}
                      {data.activeShift.movements.length === 1 ? "movimiento" : "movimientos"}
                    </span>
                  </div>
                </div>

                <div className="grid gap-2 pt-2 border-t border-[#ddd2b6]">
                  <span className="az-section-kicker">Ventas por método de pago</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {PAYMENT_METHOD_OPTIONS.map((opt) => (
                      <div
                        key={opt.value}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[#ddd2b6] px-3 py-2 text-sm"
                      >
                        <span className="text-muted-foreground">{opt.label}</span>
                        <strong className="az-money">
                          {formatMoney(data.activeShift!.byMethod[opt.value], data.currencyCode)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2 pt-2 border-t border-[#ddd2b6]">
                  <span className="az-section-kicker">Movimientos de efectivo del turno</span>
                  {data.activeShift.movements.length > 0 ? (
                    <ul className="az-rows">
                      {data.activeShift.movements.map((mov) => (
                        <li key={mov._id}>
                          <div className="az-row-main">
                            <div className="az-row-text">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`az-badge ${mov.kind === "ingreso" ? "success" : "warn"}`}
                                >
                                  {mov.kind === "ingreso" ? "Ingreso" : "Retiro"}
                                </span>
                                <strong className="text-sm">{mov.reason}</strong>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {mov.createdByName} · {formatDateTime(mov.createdAt)}
                              </span>
                            </div>
                            <strong
                              className={`az-money text-sm ${
                                mov.kind === "ingreso" ? "text-[#236a3a]" : "text-[#9b6011]"
                              }`}
                            >
                              {mov.kind === "ingreso" ? "+" : "−"}
                              {formatMoney(mov.amountCents, data.currencyCode)}
                            </strong>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sin ingresos ni retiros de efectivo registrados en este turno.
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="az-card">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="grid gap-1">
                  <h2 className="font-heading text-2xl font-extrabold tracking-tight">
                    No hay un turno abierto
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-[54ch]">
                    Abre tu turno indicando con cuánto efectivo arranca la caja para que todos los
                    cobros, ingresos y retiros cuadren en el corte final.
                  </p>
                </div>
                <Button className="site-button" onClick={() => setOpenShiftModal(true)}>
                  <Wallet className="size-4" aria-hidden="true" />
                  Abrir turno de caja
                </Button>
              </div>
            </div>
          )}

          <section className="grid gap-3" aria-label="Cortes anteriores">
            <h2 className="font-heading text-xl font-bold tracking-tight">Cortes anteriores</h2>
            {data.pastShifts.length > 0 ? (
              <ul className="az-rows">
                {data.pastShifts.map((shift) => {
                  const diffBadge =
                    shift.diffCents === 0 ? (
                      <span className="az-badge success">Cuadra exacto</span>
                    ) : shift.diffCents > 0 ? (
                      <span className="az-badge warn">
                        Sobra {formatMoney(shift.diffCents, data.currencyCode)}
                      </span>
                    ) : (
                      <span className="az-badge danger">
                        Falta {formatMoney(Math.abs(shift.diffCents), data.currencyCode)}
                      </span>
                    );
                  return (
                    <li key={shift._id}>
                      <div className="az-row-main">
                        <div className="az-row-text">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-sm font-bold">{shift.cashierName}</strong>
                            {diffBadge}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(shift.openedAt)} → {formatDateTime(shift.closedAt)} ·{" "}
                            {shift.paymentCount}{" "}
                            {shift.paymentCount === 1 ? "cobro" : "cobros"}
                          </span>
                        </div>
                        <div className="az-row-actions">
                          <div className="text-right mr-2">
                            <div className="az-money text-sm">
                              {formatMoney(shift.salesCents, data.currencyCode)}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              Contado {formatMoney(shift.countedCashCents, data.currencyCode)}
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => setViewingPastCut(shift)}
                          >
                            Ver resumen
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={<Clock className="size-7" aria-hidden="true" />}
                title="Todavía no hay cortes cerrados"
                description="Cuando cierres tu primer turno de caja, aquí quedará guardado el historial de cortes."
              />
            )}
          </section>
        </div>
      )}

      {tab === "cobradas" && (
        <div className="grid gap-5">
          <div className="az-toolbar">
            <div className="az-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={closedSearch}
                onChange={(e) => setClosedSearch(e.target.value)}
                placeholder="Buscar por folio, mesa, cliente o método de pago"
                aria-label="Buscar cuentas cobradas"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="az-badge">
                {filteredClosed.length}{" "}
                {filteredClosed.length === 1 ? "cuenta" : "cuentas"}
              </span>
              <span className="az-badge success">
                Total: {formatMoney(closedTotalCents, data.currencyCode)}
              </span>
              {closedTipsCents > 0 && (
                <span className="az-badge">
                  Propinas: {formatMoney(closedTipsCents, data.currencyCode)}
                </span>
              )}
            </div>
          </div>

          {filteredClosed.length > 0 ? (
            <ul className="az-rows">
              {filteredClosed.map((acc) => (
                <li key={acc._id}>
                  <div className="az-row-main">
                    <div className="az-row-text">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="font-heading text-base font-bold">{acc.label}</strong>
                        <span className="az-badge success">
                          <BadgeCheck aria-hidden="true" />
                          Cobrada
                        </span>
                        {acc.methods.map((method) => (
                          <span key={method} className="az-badge">
                            {PAYMENT_METHOD_LABELS[method]}
                          </span>
                        ))}
                        {acc.discountCents > 0 && (
                          <span className="az-badge">
                            Desc. −{formatMoney(acc.discountCents, data.currencyCode)}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Folio A-{String(acc.folio).padStart(4, "0")}
                        {acc.assignedStaffName ? ` · Mesero: ${acc.assignedStaffName}` : ""} ·
                        Cerrada {formatDateTime(acc.closedAt)}
                        {acc.tipCents > 0
                          ? ` · Propina ${formatMoney(acc.tipCents, data.currencyCode)}`
                          : ""}
                      </span>
                    </div>

                    <div className="az-row-actions">
                      <strong className="az-money text-sm mr-1">
                        {formatMoney(acc.totalCents, data.currencyCode)}
                      </strong>
                      <Link
                        href={`/cuenta/mesero/cuenta/${acc._id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:border-foreground"
                      >
                        Ver
                      </Link>
                      {acc.canReopen && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => setReopenTarget(acc)}
                        >
                          <RotateCcw className="size-3" aria-hidden="true" />
                          Reabrir
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<BadgeCheck className="size-7" aria-hidden="true" />}
              title={
                data.closedAccounts.length === 0
                  ? "Todavía no hay cuentas cobradas"
                  : "Sin coincidencias"
              }
              description={
                data.closedAccounts.length === 0
                  ? "Cada cuenta que cierres desde Caja o con confirmación rápida aparecerá aquí."
                  : "Intenta con otro folio, mesa o método de pago."
              }
            />
          )}
        </div>
      )}

      {tab === "agotados" && (
        <div className="grid gap-4">
          <div className="az-toolbar">
            <div className="az-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={dishSearch}
                onChange={(e) => setDishSearch(e.target.value)}
                placeholder="Buscar platillo o categoría"
                aria-label="Buscar platillo"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Los cambios se reflejan al instante en el menú de los meseros.
            </span>
          </div>

          {filteredDishes.length > 0 ? (
            <ul className="az-rows">
              {filteredDishes.map((dish) => (
                <li key={dish._id}>
                  <div className="az-row-main">
                    <div className="az-row-text">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm font-bold">{dish.name}</strong>
                        <span className="az-badge">{dish.categoryName}</span>
                        {dish.autoSoldOutByInventory ? (
                          <span className="az-badge danger">
                            Agotado automático: un insumo llegó a cero
                          </span>
                        ) : !dish.isAvailable ? (
                          <span className="az-badge warn">Agotado manual</span>
                        ) : (
                          <span className="az-badge success">Disponible</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatMoney(dish.priceCents, data.currencyCode)}
                      </span>
                    </div>
                    <div className="az-row-actions">
                      <Button
                        type="button"
                        size="xs"
                        variant={dish.isAvailable ? "outline" : "default"}
                        disabled={togglingDishId === dish._id}
                        onClick={() =>
                          void handleToggleDish(dish._id, !dish.isAvailable, dish.name)
                        }
                      >
                        {dish.isAvailable ? "Marcar agotado" : "Habilitar de nuevo"}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<PackageX className="size-7" aria-hidden="true" />}
              title="Sin platillos publicados"
              description="Cuando el menú tenga platillos publicados, podrás pausarlos rápidamente desde aquí."
            />
          )}
        </div>
      )}

      {chargeTarget && (
        <ChargeModal
          target={chargeTarget}
          currencyCode={data.currencyCode}
          hasOpenShift={data.activeShift !== null}
          onClose={() => setChargeTarget(null)}
          onCompleted={({ closed }) => {
            showToast(closed ? "Cuenta cobrada y cerrada" : "Abono parcial registrado");
          }}
        />
      )}

      {reopenTarget && (
        <ReopenAccountModal
          accountId={reopenTarget._id}
          folio={reopenTarget.folio}
          label={reopenTarget.label}
          onClose={() => setReopenTarget(null)}
          onReopened={(msg) => {
            setReopenTarget(null);
            showToast(msg);
          }}
        />
      )}

      {openShiftModal && (
        <OpenShiftModal
          onClose={() => setOpenShiftModal(false)}
          onSubmit={async (fundCents) => {
            await openShift({ fundCents });
            setOpenShiftModal(false);
            setTab("turno");
            showToast("Turno de caja abierto");
          }}
        />
      )}

      {movementModal && (
        <CashMovementModal
          kind={movementModal}
          onClose={() => setMovementModal(null)}
          onSubmit={async (amountCents, reason) => {
            await recordCashMovement({ kind: movementModal, amountCents, reason });
            setMovementModal(null);
            showToast(
              movementModal === "ingreso"
                ? "Ingreso de efectivo registrado"
                : "Retiro de efectivo registrado",
            );
          }}
        />
      )}

      {cutModalOpen && data.activeShift && (
        <CloseShiftModal
          expectedCashCents={data.activeShift.expectedCashCents}
          salesCents={data.activeShift.salesCents}
          tipsCents={data.activeShift.tipsCents}
          currencyCode={data.currencyCode}
          onClose={() => setCutModalOpen(false)}
          onSubmit={async (countedCashCents) => {
            await closeShift({ countedCashCents });
            setCutModalOpen(false);
            showToast("Corte de caja cerrado");
          }}
        />
      )}

      {viewingPastCut && (
        <PastShiftSummaryModal
          shift={viewingPastCut}
          currencyCode={data.currencyCode}
          onClose={() => setViewingPastCut(null)}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}

function OpenShiftModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (fundCents: number) => Promise<void>;
}) {
  const [fund, setFund] = useState("1500.00");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = parseMoneyCents(fund);
    if (Number.isNaN(cents) || cents < 0) {
      setError("Escribe un fondo inicial válido (puede ser 0.00).");
      return;
    }
    setPending(true);
    try {
      await onSubmit(cents);
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos abrir el turno."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title="Abrir turno de caja"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="open-shift-form" className="site-button" disabled={pending}>
            <Wallet className="size-4" aria-hidden="true" />
            {pending ? "Abriendo…" : "Abrir turno"}
          </Button>
        </>
      }
    >
      <form id="open-shift-form" className="grid gap-4" onSubmit={submit}>
        <p className="text-sm text-muted-foreground">
          Indica el efectivo con el que arranca tu gaveta. Al cerrar el turno compararemos este
          fondo más tus cobros y movimientos contra lo que cuentes.
        </p>
        <div className="az-field">
          <label htmlFor="shift-fund">Fondo inicial en efectivo ($)</label>
          <input
            id="shift-fund"
            type="text"
            inputMode="decimal"
            value={fund}
            onChange={(e) => setFund(e.target.value)}
            placeholder="1500.00"
            required
            autoFocus
          />
        </div>
        {error && (
          <p className="floor-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </AdminModal>
  );
}

function CashMovementModal({
  kind,
  onClose,
  onSubmit,
}: {
  kind: "ingreso" | "retiro";
  onClose: () => void;
  onSubmit: (amountCents: number, reason: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = parseMoneyCents(amount);
    if (Number.isNaN(cents) || cents <= 0) {
      setError("Escribe un monto válido mayor a cero.");
      return;
    }
    if (!reason.trim()) {
      setError("Escribe el motivo del movimiento.");
      return;
    }
    setPending(true);
    try {
      await onSubmit(cents, reason.trim());
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos guardar el movimiento."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={kind === "ingreso" ? "Registrar ingreso de efectivo" : "Registrar retiro de efectivo"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="cash-mov-form" className="site-button" disabled={pending}>
            {pending ? "Guardando…" : kind === "ingreso" ? "Guardar ingreso" : "Guardar retiro"}
          </Button>
        </>
      }
    >
      <form id="cash-mov-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-field">
          <label htmlFor="mov-amt">Monto ($)</label>
          <input
            id="mov-amt"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="200.00"
            required
            autoFocus
          />
        </div>
        <div className="az-field">
          <label htmlFor="mov-reason">Motivo</label>
          <input
            id="mov-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              kind === "ingreso"
                ? "Ej. Cambio adicional para la caja"
                : "Ej. Pago a proveedor de hielo o envío a bóveda"
            }
            maxLength={160}
            required
          />
        </div>
        {error && (
          <p className="floor-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </AdminModal>
  );
}

function CloseShiftModal({
  expectedCashCents,
  salesCents,
  tipsCents,
  currencyCode,
  onClose,
  onSubmit,
}: {
  expectedCashCents: number;
  salesCents: number;
  tipsCents: number;
  currencyCode: string;
  onClose: () => void;
  onSubmit: (countedCashCents: number) => Promise<void>;
}) {
  const [counted, setCounted] = useState((expectedCashCents / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const countedCents = parseMoneyCents(counted);
  const diffCents = Number.isNaN(countedCents) ? null : countedCents - expectedCashCents;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (Number.isNaN(countedCents) || countedCents < 0) {
      setError("Escribe el efectivo contado en caja.");
      return;
    }
    setPending(true);
    try {
      await onSubmit(countedCents);
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos cerrar el turno."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title="Hacer corte y cerrar turno"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="close-shift-form"
            className="site-button az-coral-cta"
            disabled={pending}
          >
            <Calculator className="size-4" aria-hidden="true" />
            {pending ? "Cerrando…" : "Confirmar corte y cerrar"}
          </Button>
        </>
      }
    >
      <form id="close-shift-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-totals !border-t-0 !pt-0">
          <div>
            <span>Ventas del turno</span>
            <strong className="az-money">{formatMoney(salesCents, currencyCode)}</strong>
          </div>
          <div>
            <span>Propinas (aparte)</span>
            <span className="az-money">{formatMoney(tipsCents, currencyCode)}</span>
          </div>
          <div className="grand">
            <span>Efectivo esperado en caja</span>
            <span className="az-money">{formatMoney(expectedCashCents, currencyCode)}</span>
          </div>
        </div>

        <div className="az-field">
          <label htmlFor="cut-counted">Efectivo contado físicamente ($)</label>
          <input
            id="cut-counted"
            type="text"
            inputMode="decimal"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            required
            autoFocus
          />
        </div>

        {diffCents !== null && (
          <div
            className={`az-notice ${
              diffCents === 0 ? "ok" : diffCents > 0 ? "warn" : "danger"
            }`}
          >
            <strong>
              {diffCents === 0
                ? "La caja cuadra exacta."
                : diffCents > 0
                  ? `Sobra ${formatMoney(diffCents, currencyCode)} respecto al esperado.`
                  : `Falta ${formatMoney(Math.abs(diffCents), currencyCode)} respecto al esperado.`}
            </strong>
          </div>
        )}

        {error && (
          <p className="floor-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </AdminModal>
  );
}

function PastShiftSummaryModal({
  shift,
  currencyCode,
  onClose,
}: {
  shift: PastShift;
  currencyCode: string;
  onClose: () => void;
}) {
  return (
    <AdminModal
      title={`Resumen de corte · ${shift.cashierName}`}
      onClose={onClose}
      footer={
        <Button type="button" className="site-button" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      <div className="grid gap-4">
        <p className="text-xs text-muted-foreground">
          Abierto {formatDateTime(shift.openedAt)} · Cerrado {formatDateTime(shift.closedAt)} por{" "}
          {shift.closedByName}
        </p>

        <div className="az-totals !border-t-0 !pt-0">
          <div>
            <span>Fondo inicial</span>
            <span className="az-money">{formatMoney(shift.fundCents, currencyCode)}</span>
          </div>
          <div>
            <span>Ventas totales ({shift.paymentCount} pagos)</span>
            <strong className="az-money">{formatMoney(shift.salesCents, currencyCode)}</strong>
          </div>
          <div>
            <span>Propinas (aparte)</span>
            <span className="az-money">{formatMoney(shift.tipsCents, currencyCode)}</span>
          </div>
          <div>
            <span>Ingresos / Retiros</span>
            <span className="az-money">
              +{formatMoney(shift.insCents, currencyCode)} / −
              {formatMoney(shift.outsCents, currencyCode)}
            </span>
          </div>
          <div>
            <span>Efectivo esperado</span>
            <strong className="az-money">
              {formatMoney(shift.expectedCashCents, currencyCode)}
            </strong>
          </div>
          <div>
            <span>Efectivo contado</span>
            <strong className="az-money">
              {formatMoney(shift.countedCashCents, currencyCode)}
            </strong>
          </div>
          <div className="grand">
            <span>Diferencia</span>
            <span className="az-money">
              {shift.diffCents === 0
                ? "$0.00 (Exacto)"
                : shift.diffCents > 0
                  ? `+${formatMoney(shift.diffCents, currencyCode)}`
                  : `−${formatMoney(Math.abs(shift.diffCents), currencyCode)}`}
            </span>
          </div>
        </div>

        <div className="grid gap-2 pt-2 border-t border-[#ddd2b6]">
          <span className="az-section-kicker">Desglose por método</span>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(shift.byMethod) as PaymentMethodValue[]).map((method) => (
              <div
                key={method}
                className="flex items-center justify-between rounded-lg border border-[#ddd2b6] px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground">{PAYMENT_METHOD_LABELS[method]}</span>
                <strong className="az-money">
                  {formatMoney(shift.byMethod[method], currencyCode)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminModal>
  );
}
