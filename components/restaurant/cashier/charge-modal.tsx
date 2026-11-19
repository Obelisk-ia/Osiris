"use client";

import { useMutation } from "convex/react";
import {
  BadgeCheck,
  Check,
  CreditCard,
  Info,
  Percent,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AdminModal } from "@/components/restaurant/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { centsToInput, errorMessage, formatMoney, parseMoneyCents } from "@/lib/format";

export type PaymentMethodValue = "efectivo" | "tarjeta" | "transferencia" | "vales";

export const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{
  value: PaymentMethodValue;
  label: string;
}> = [
  { value: "efectivo", label: "Efectivo" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "transferencia", label: "Transferencia" },
  { value: "vales", label: "Vales" },
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodValue, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  vales: "Vales",
};

type PayRow = {
  key: number;
  method: PaymentMethodValue;
  amount: string;
  terminalFolio: string;
};

let rowSeq = 1;

export type ReportedPaymentInfo = {
  method: PaymentMethodValue;
  receivedCents: number;
  tipCents: number;
  terminalFolio: string | null;
  note: string | null;
  reportedByName: string;
  reportedAt: number;
};

export type ChargeTarget = {
  accountId: Id<"accounts">;
  folio: number;
  label: string;
  totalCents: number;
  discountCents: number;
  paidCents: number;
  balanceCents: number;
  reportedPayment?: ReportedPaymentInfo | null;
};

export function ChargeModal({
  target,
  currencyCode,
  hasOpenShift,
  onClose,
  onCompleted,
}: {
  target: ChargeTarget;
  currencyCode: string;
  hasOpenShift: boolean;
  onClose: () => void;
  onCompleted?: (result: { closed: boolean; changeCents: number }) => void;
}) {
  const chargeAccount = useMutation(api.cashier.chargeAccount);
  const dismissReported = useMutation(api.cashier.dismissReportedPayment);

  const report = target.reportedPayment ?? null;
  const [rows, setRows] = useState<PayRow[]>([
    {
      key: ++rowSeq,
      method: report?.method ?? "efectivo",
      amount: report
        ? centsToInput(report.receivedCents)
        : target.balanceCents > 0
          ? centsToInput(target.balanceCents)
          : "0.00",
      terminalFolio: report?.terminalFolio ?? "",
    },
  ]);
  const [tipMode, setTipMode] = useState<"none" | "pct10" | "pct15" | "pct" | "amt">(
    report && report.tipCents > 0 ? "amt" : "none",
  );
  const [tipInput, setTipInput] = useState(
    report && report.tipCents > 0 ? centsToInput(report.tipCents) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [receipt, setReceipt] = useState<{
    closed: boolean;
    folio: number;
    paidNowCents: number;
    tipNowCents: number;
    changeCents: number;
    remainingBalanceCents: number;
    attachedToShift: boolean;
  } | null>(null);

  const isZeroCourtesy = target.balanceCents === 0 && target.discountCents > 0;

  const tipCents = (() => {
    if (isZeroCourtesy || tipMode === "none") return 0;
    if (tipMode === "pct10") return Math.round(target.balanceCents * 0.1);
    if (tipMode === "pct15") return Math.round(target.balanceCents * 0.15);
    if (tipMode === "pct") {
      const pct = Number(tipInput);
      if (!Number.isFinite(pct) || pct <= 0) return 0;
      return Math.round((target.balanceCents * Math.min(pct, 100)) / 100);
    }
    const parsed = parseMoneyCents(tipInput);
    return Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
  })();

  const parsedRows = rows.map((row) => ({
    ...row,
    cents: parseMoneyCents(row.amount),
  }));
  const totalReceivedCents = parsedRows.reduce(
    (sum, r) => sum + (Number.isNaN(r.cents) ? 0 : r.cents),
    0,
  );
  const cashReceivedCents = parsedRows
    .filter((r) => r.method === "efectivo")
    .reduce((sum, r) => sum + (Number.isNaN(r.cents) ? 0 : r.cents), 0);
  const nonCashReceivedCents = totalReceivedCents - cashReceivedCents;
  const dueWithTipCents = target.balanceCents + tipCents;
  const diffCents = totalReceivedCents - dueWithTipCents;
  const nonCashOver = nonCashReceivedCents > dueWithTipCents;

  function updateRow(key: number, patch: Partial<PayRow>) {
    setError(null);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const remaining = Math.max(0, dueWithTipCents - totalReceivedCents);
    setRows((prev) => [
      ...prev,
      {
        key: ++rowSeq,
        method: prev.some((r) => r.method === "efectivo") ? "tarjeta" : "efectivo",
        amount: remaining > 0 ? centsToInput(remaining) : "",
        terminalFolio: "",
      },
    ]);
  }

  function removeRow(key: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  function fillExact(key: number) {
    const othersTotal = parsedRows
      .filter((r) => r.key !== key)
      .reduce((sum, r) => sum + (Number.isNaN(r.cents) ? 0 : r.cents), 0);
    const needed = Math.max(0, dueWithTipCents - othersTotal);
    updateRow(key, { amount: centsToInput(needed) });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (isZeroCourtesy) {
      setPending(true);
      try {
        const res = await chargeAccount({
          accountId: target.accountId,
          payments: [],
          tipCents: 0,
        });
        setReceipt(res);
        onCompleted?.({ closed: res.closed, changeCents: res.changeCents });
      } catch (cause) {
        setError(errorMessage(cause, "No pudimos cerrar la cuenta."));
      } finally {
        setPending(false);
      }
      return;
    }

    const payload: Array<{
      method: PaymentMethodValue;
      receivedCents: number;
      terminalFolio?: string;
    }> = [];
    for (const row of parsedRows) {
      if (Number.isNaN(row.cents) || row.cents <= 0) {
        setError("Escribe un monto válido mayor a cero en cada línea de pago.");
        return;
      }
      payload.push({
        method: row.method,
        receivedCents: row.cents,
        terminalFolio: row.method === "tarjeta" ? row.terminalFolio.trim() || undefined : undefined,
      });
    }
    if (nonCashOver) {
      setError("El monto en tarjeta, transferencia o vales no puede superar el total más la propina.");
      return;
    }
    if (totalReceivedCents < tipCents) {
      setError("El monto recibido no alcanza para cubrir la propina indicada.");
      return;
    }

    setPending(true);
    try {
      const res = await chargeAccount({
        accountId: target.accountId,
        payments: payload,
        tipCents,
      });
      setReceipt(res);
      onCompleted?.({ closed: res.closed, changeCents: res.changeCents });
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos registrar el cobro."));
    } finally {
      setPending(false);
    }
  }

  if (receipt) {
    return (
      <AdminModal
        title={receipt.closed ? "Cuenta cobrada y cerrada" : "Abono registrado"}
        onClose={onClose}
        footer={
          <Button type="button" className="site-button" onClick={onClose}>
            <Check className="size-4" aria-hidden="true" />
            Listo
          </Button>
        }
      >
        <div className="grid gap-4">
          <div className="az-notice ok">
            <BadgeCheck className="size-5 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="grid gap-1">
              <strong>
                {target.label} · Folio A-{String(receipt.folio).padStart(4, "0")}
              </strong>
              <span>
                {receipt.closed
                  ? "El pago cubrió el total. La cuenta se cerró y la mesa quedó libre."
                  : `Se abonaron ${formatMoney(receipt.paidNowCents, currencyCode)}. Aún falta ${formatMoney(receipt.remainingBalanceCents, currencyCode)} por cobrar.`}
              </span>
            </div>
          </div>

          <div className="az-totals">
            <div>
              <span>Aplicado a la cuenta</span>
              <strong className="az-money">{formatMoney(receipt.paidNowCents, currencyCode)}</strong>
            </div>
            {receipt.tipNowCents > 0 && (
              <div>
                <span>Propina (aparte)</span>
                <span className="az-money">{formatMoney(receipt.tipNowCents, currencyCode)}</span>
              </div>
            )}
            {receipt.changeCents > 0 && (
              <div className="grand text-[#236a3a]">
                <span>Cambio a entregar</span>
                <span className="az-money">{formatMoney(receipt.changeCents, currencyCode)}</span>
              </div>
            )}
            {!receipt.closed && (
              <div className="grand text-[#9b6011]">
                <span>Falta por cobrar</span>
                <span className="az-money">
                  {formatMoney(receipt.remainingBalanceCents, currencyCode)}
                </span>
              </div>
            )}
          </div>

          {!receipt.attachedToShift && (
            <p className="text-xs text-muted-foreground">
              Este cobro quedó guardado en <strong>Ya cobradas</strong> sin turno de caja abierto.
            </p>
          )}
        </div>
      </AdminModal>
    );
  }

  async function handleDismissReport() {
    if (!report || dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      await dismissReported({
        accountId: target.accountId,
        reason: "Verifica el monto o comprobante entregado en caja.",
      });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos devolver el reporte al mesero."));
    } finally {
      setDismissing(false);
    }
  }

  return (
    <AdminModal
      title={`${report ? "Confirmar pago reportado" : "Cobrar"} · ${target.label}`}
      wide
      onClose={onClose}
      footer={
        <>
          {report && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              disabled={pending || dismissing}
              onClick={() => void handleDismissReport()}
            >
              {dismissing ? "Devolviendo…" : "Devolver reporte al mesero"}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={pending || dismissing} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="charge-form"
            className="site-button az-coral-cta"
            disabled={pending || dismissing || (!isZeroCourtesy && nonCashOver)}
          >
            <Wallet className="size-4" aria-hidden="true" />
            {pending
              ? "Registrando…"
              : isZeroCourtesy
                ? "Cerrar cortesía"
                : diffCents >= 0
                  ? "Confirmar cobro"
                  : "Registrar abono parcial"}
          </Button>
        </>
      }
    >
      <form id="charge-form" className="grid gap-4" onSubmit={submit}>
        {report && (
          <div className="az-notice warn">
            <BadgeCheck className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="grid gap-0.5">
              <strong>
                Pago reportado por {report.reportedByName}:{" "}
                {formatMoney(report.receivedCents, currencyCode)} en{" "}
                {PAYMENT_METHOD_LABELS[report.method]}
                {report.tipCents > 0
                  ? ` (+ ${formatMoney(report.tipCents, currencyCode)} propina)`
                  : ""}
              </strong>
              <span className="text-xs">
                Verifica el efectivo o comprobante físico antes de confirmar. Puedes editar los
                campos si hubo algún ajuste.
                {report.note ? ` · Nota: "${report.note}"` : ""}
              </span>
            </div>
          </div>
        )}
        <div className="az-totals !border-t-0 !pt-0">
          <div className="text-xs text-muted-foreground">
            <span>Folio A-{String(target.folio).padStart(4, "0")}</span>
            <span>Total cuenta: {formatMoney(target.totalCents, currencyCode)}</span>
          </div>
          {target.discountCents > 0 && (
            <div className="text-xs text-muted-foreground">
              <span>Descuento aplicado</span>
              <span>−{formatMoney(target.discountCents, currencyCode)}</span>
            </div>
          )}
          {target.paidCents > 0 && (
            <div className="text-xs text-muted-foreground">
              <span>Ya pagado</span>
              <span>{formatMoney(target.paidCents, currencyCode)}</span>
            </div>
          )}
          <div className="grand">
            <span>Falta por cobrar</span>
            <span className="az-money">{formatMoney(target.balanceCents, currencyCode)}</span>
          </div>
        </div>

        {!hasOpenShift && (
          <div className="az-notice">
            <Info className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="text-xs">
              No hay turno de caja abierto. Puedes cobrar normalmente; si quieres llevar corte de efectivo,
              abre un turno en <strong>Turno y corte</strong>.
            </span>
          </div>
        )}

        {isZeroCourtesy ? (
          <div className="az-notice ok">
            <BadgeCheck className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Esta cuenta tiene un descuento del 100% (cortesía). Al confirmar se cerrará con saldo en $0.00.
            </span>
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="az-section-kicker">Métodos de pago</span>
                {rows.length < 6 && (
                  <Button type="button" variant="outline" size="xs" onClick={addRow}>
                    <Plus className="size-3.5" aria-hidden="true" />
                    Agregar método
                  </Button>
                )}
              </div>

              {rows.map((row, idx) => (
                <div
                  key={row.key}
                  className="grid gap-2.5 rounded-xl border border-[#ddd2b6] bg-[#faf5e7] p-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2.5 items-end">
                    <div className="az-field">
                      <label htmlFor={`pay-method-${row.key}`}>Método {idx + 1}</label>
                      <select
                        id={`pay-method-${row.key}`}
                        value={row.method}
                        onChange={(e) =>
                          updateRow(row.key, {
                            method: e.target.value as PaymentMethodValue,
                          })
                        }
                      >
                        {PAYMENT_METHOD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="az-field">
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor={`pay-amt-${row.key}`}>Monto recibido</label>
                        <button
                          type="button"
                          className="text-[11px] font-semibold underline text-muted-foreground hover:text-foreground"
                          onClick={() => fillExact(row.key)}
                        >
                          Exacto
                        </button>
                      </div>
                      <input
                        id={`pay-amt-${row.key}`}
                        type="text"
                        inputMode="decimal"
                        value={row.amount}
                        onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                        placeholder="0.00"
                        required
                      />
                    </div>
                    {rows.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Quitar método ${idx + 1}`}
                        onClick={() => removeRow(row.key)}
                      >
                        <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                      </Button>
                    )}
                  </div>

                  {row.method === "tarjeta" && (
                    <div className="az-field">
                      <label htmlFor={`pay-folio-${row.key}`}>
                        Folio de terminal <span className="font-normal text-muted-foreground">(opcional)</span>
                      </label>
                      <div className="relative">
                        <input
                          id={`pay-folio-${row.key}`}
                          type="text"
                          value={row.terminalFolio}
                          onChange={(e) => updateRow(row.key, { terminalFolio: e.target.value })}
                          placeholder="Ej. 482910"
                          maxLength={40}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-2">
              <span className="az-section-kicker">Propina (opcional, se registra aparte)</span>
              <div className="az-chips" role="group" aria-label="Propina">
                {(
                  [
                    { id: "none", label: "Sin propina" },
                    { id: "pct10", label: "10%" },
                    { id: "pct15", label: "15%" },
                    { id: "pct", label: "Otro %" },
                    { id: "amt", label: "$ Monto" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="az-chip"
                    aria-pressed={tipMode === opt.id}
                    onClick={() => {
                      setTipMode(opt.id);
                      setTipInput("");
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {(tipMode === "pct" || tipMode === "amt") && (
                <div className="az-field max-w-[220px]">
                  <label htmlFor="pay-tip-custom">
                    {tipMode === "pct" ? "Porcentaje (%)" : "Monto de propina ($)"}
                  </label>
                  <input
                    id="pay-tip-custom"
                    type="text"
                    inputMode="decimal"
                    value={tipInput}
                    onChange={(e) => setTipInput(e.target.value)}
                    placeholder={tipMode === "pct" ? "12" : "50.00"}
                  />
                </div>
              )}
            </div>

            <div className="az-totals">
              <div>
                <span>Total con propina</span>
                <span className="az-money">{formatMoney(dueWithTipCents, currencyCode)}</span>
              </div>
              <div>
                <span>Recibe</span>
                <span className="az-money">{formatMoney(totalReceivedCents, currencyCode)}</span>
              </div>
              {nonCashOver ? (
                <div className="text-destructive font-semibold">
                  <span>Exceso sin efectivo</span>
                  <span className="az-money">
                    +{formatMoney(nonCashReceivedCents - dueWithTipCents, currencyCode)}
                  </span>
                </div>
              ) : diffCents > 0 ? (
                <div className="grand text-[#236a3a]">
                  <span>Cambio a entregar</span>
                  <span className="az-money">{formatMoney(diffCents, currencyCode)}</span>
                </div>
              ) : diffCents < 0 ? (
                <div className="grand text-[#9b6011]">
                  <span>Seguirá faltando (abono parcial)</span>
                  <span className="az-money">{formatMoney(Math.abs(diffCents), currencyCode)}</span>
                </div>
              ) : (
                <div className="grand text-[#236a3a]">
                  <span>Cubierto exacto</span>
                  <span className="az-money">$0.00</span>
                </div>
              )}
            </div>
          </>
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

export function DiscountModal({
  accountId,
  grossCents,
  currentKind,
  currentValue,
  currentReason,
  currencyCode,
  onClose,
  onApplied,
}: {
  accountId: Id<"accounts">;
  grossCents: number;
  currentKind: "pct" | "amt" | null;
  currentValue: number | null;
  currentReason: string | null;
  currencyCode: string;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const applyDiscount = useMutation(api.cashier.applyDiscount);
  const [kind, setKind] = useState<"pct" | "amt">(currentKind ?? "pct");
  const [value, setValue] = useState(() => {
    if (currentKind === "pct" && currentValue) return String(currentValue);
    if (currentKind === "amt" && currentValue) return centsToInput(currentValue);
    return "10";
  });
  const [reason, setReason] = useState(currentReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const previewDiscountCents = (() => {
    if (kind === "pct") {
      const pct = Math.round(Number(value));
      if (!Number.isFinite(pct) || pct <= 0) return 0;
      return Math.min(grossCents, Math.round((grossCents * Math.min(100, pct)) / 100));
    }
    const cents = parseMoneyCents(value);
    if (Number.isNaN(cents) || cents <= 0) return 0;
    return Math.min(grossCents, cents);
  })();
  const previewTotalCents = Math.max(0, grossCents - previewDiscountCents);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError("Escribe el motivo del descuento o cortesía.");
      return;
    }
    const numericValue = kind === "pct" ? Math.round(Number(value)) : parseMoneyCents(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      setError("Escribe un valor válido mayor a cero.");
      return;
    }
    setPending(true);
    try {
      await applyDiscount({
        accountId,
        kind,
        value: numericValue,
        reason: reason.trim(),
      });
      onApplied("Descuento aplicado a la cuenta");
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos aplicar el descuento."));
    } finally {
      setPending(false);
    }
  }

  async function handleRemove() {
    setPending(true);
    setError(null);
    try {
      await applyDiscount({ accountId, kind: "none" });
      onApplied("Descuento retirado de la cuenta");
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos retirar el descuento."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title="Aplicar descuento o cortesía"
      onClose={onClose}
      footer={
        <>
          {currentKind && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              disabled={pending}
              onClick={() => void handleRemove()}
            >
              Quitar descuento
            </Button>
          )}
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="discount-form" className="site-button" disabled={pending}>
            <Percent className="size-4" aria-hidden="true" />
            {pending ? "Guardando…" : "Aplicar descuento"}
          </Button>
        </>
      }
    >
      <form id="discount-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-chips" role="group" aria-label="Tipo de descuento">
          <button
            type="button"
            className="az-chip"
            aria-pressed={kind === "pct"}
            onClick={() => {
              setKind("pct");
              setValue("10");
            }}
          >
            Porcentaje (%)
          </button>
          <button
            type="button"
            className="az-chip"
            aria-pressed={kind === "amt"}
            onClick={() => {
              setKind("amt");
              setValue("");
            }}
          >
            Monto fijo ($)
          </button>
        </div>

        <div className="az-form-grid">
          <div className="az-field">
            <label htmlFor="disc-val">
              {kind === "pct" ? "Porcentaje (1–100%)" : "Monto a descontar ($)"}
            </label>
            <input
              id="disc-val"
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "pct" ? "10" : "100.00"}
              required
              autoFocus
            />
          </div>
          <div className="az-field">
            <label htmlFor="disc-reason">Motivo</label>
            <input
              id="disc-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. Cortesía por cumpleaños o demora"
              maxLength={160}
              required
            />
          </div>
        </div>

        <div className="az-totals">
          <div className="text-xs text-muted-foreground">
            <span>Consumo original</span>
            <span>{formatMoney(grossCents, currencyCode)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            <span>Descuento</span>
            <span>−{formatMoney(previewDiscountCents, currencyCode)}</span>
          </div>
          <div className="grand">
            <span>Nuevo total</span>
            <span className="az-money">{formatMoney(previewTotalCents, currencyCode)}</span>
          </div>
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

export function ReopenAccountModal({
  accountId,
  folio,
  label,
  onClose,
  onReopened,
}: {
  accountId: Id<"accounts">;
  folio: number;
  label: string;
  onClose: () => void;
  onReopened: (message: string) => void;
}) {
  const reopenAccount = useMutation(api.cashier.reopenAccount);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError("Escribe el motivo para reabrir la cuenta.");
      return;
    }
    setPending(true);
    try {
      const res = await reopenAccount({ accountId, reason: reason.trim() });
      onReopened(
        `Cuenta A-${String(res.folio).padStart(4, "0")} reabierta (${res.revertedCount} ${res.revertedCount === 1 ? "pago revertido" : "pagos revertidos"})`,
      );
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos reabrir la cuenta."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={`Reabrir cuenta · ${label}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="reopen-form" variant="destructive" disabled={pending}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {pending ? "Reabriendo…" : "Sí, reabrir y revertir pagos"}
          </Button>
        </>
      }
    >
      <form id="reopen-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-notice warn">
          <CreditCard className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Folio <strong>A-{String(folio).padStart(4, "0")}</strong>. Todos los pagos registrados se
            marcarán como revertidos y la cuenta volverá a <strong>Listas para cobrar</strong>.
          </span>
        </div>
        <div className="az-field">
          <label htmlFor="reopen-reason">Motivo de reapertura</label>
          <input
            id="reopen-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. Error en método de pago o faltó aplicar descuento"
            maxLength={160}
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
