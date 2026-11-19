"use client";

import { useMutation } from "convex/react";
import { Info, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AdminModal } from "@/components/restaurant/admin/admin-ui";
import {
  PAYMENT_METHOD_OPTIONS,
  type PaymentMethodValue,
  type ReportedPaymentInfo,
} from "@/components/restaurant/cashier/charge-modal";
import { Button } from "@/components/ui/button";
import { centsToInput, errorMessage, formatMoney, parseMoneyCents } from "@/lib/format";

export type ReportPaymentTarget = {
  accountId: Id<"accounts">;
  folio: number;
  label: string;
  balanceCents: number;
  existingReport?: ReportedPaymentInfo | null;
};

export function ReportPaymentModal({
  target,
  currencyCode,
  onClose,
  onReported,
}: {
  target: ReportPaymentTarget;
  currencyCode: string;
  onClose: () => void;
  onReported: (message: string) => void;
}) {
  const reportPayment = useMutation(api.waiter.reportPayment);

  const existing = target.existingReport ?? null;
  const [method, setMethod] = useState<PaymentMethodValue>(existing?.method ?? "efectivo");
  const [received, setReceived] = useState(() =>
    centsToInput(existing ? existing.receivedCents : target.balanceCents),
  );
  const [terminalFolio, setTerminalFolio] = useState(existing?.terminalFolio ?? "");
  const [tipMode, setTipMode] = useState<"none" | "pct10" | "pct15" | "pct" | "amt">(
    existing && existing.tipCents > 0 ? "amt" : "none",
  );
  const [tipInput, setTipInput] = useState(
    existing && existing.tipCents > 0 ? centsToInput(existing.tipCents) : "",
  );
  const [note, setNote] = useState(existing?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const tipCents = (() => {
    if (tipMode === "none") return 0;
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

  const receivedCents = parseMoneyCents(received);
  const dueWithTip = target.balanceCents + tipCents;
  const diffCents = Number.isNaN(receivedCents) ? 0 : receivedCents - dueWithTip;
  const nonCashOver = method !== "efectivo" && !Number.isNaN(receivedCents) && receivedCents > dueWithTip;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (Number.isNaN(receivedCents) || receivedCents <= 0) {
      setError("Escribe el monto recibido mayor a cero.");
      return;
    }
    if (receivedCents < tipCents) {
      setError("El monto recibido no alcanza para cubrir la propina indicada.");
      return;
    }
    if (nonCashOver) {
      setError("En tarjeta, transferencia o vales el monto no puede superar el total más la propina.");
      return;
    }

    setPending(true);
    try {
      await reportPayment({
        accountId: target.accountId,
        method,
        receivedCents,
        tipCents,
        terminalFolio: method === "tarjeta" ? terminalFolio.trim() || undefined : undefined,
        note: note.trim() || undefined,
      });
      onReported(`Pago reportado a caja para ${target.label}. Esperando confirmación del cajero.`);
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos reportar el pago a caja."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={`${existing ? "Actualizar reporte de pago" : "Reportar pago a caja"} · ${target.label}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="report-payment-form"
            className="site-button az-coral-cta"
            disabled={pending || nonCashOver}
          >
            <Send className="size-4" aria-hidden="true" />
            {pending ? "Enviando…" : existing ? "Actualizar reporte" : "Reportar a caja"}
          </Button>
        </>
      }
    >
      <form id="report-payment-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-notice">
          <Info className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Este reporte <strong>no cierra la cuenta</strong>. Entrega el efectivo o voucher en Caja
            para que el cajero verifique y confirme el cobro.
          </span>
        </div>

        <div className="az-totals !border-t-0 !pt-0">
          <div className="text-xs text-muted-foreground">
            <span>Folio A-{String(target.folio).padStart(4, "0")}</span>
            <span>Saldo pendiente</span>
          </div>
          <div className="grand">
            <span>Por cobrar</span>
            <span className="az-money">{formatMoney(target.balanceCents, currencyCode)}</span>
          </div>
        </div>

        <div className="az-form-grid">
          <div className="az-field">
            <label htmlFor="rp-method">Método de pago</label>
            <select
              id="rp-method"
              value={method}
              onChange={(e) => {
                setError(null);
                setMethod(e.target.value as PaymentMethodValue);
              }}
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
              <label htmlFor="rp-amt">Monto recibido ($)</label>
              <button
                type="button"
                className="text-[11px] font-semibold underline text-muted-foreground hover:text-foreground"
                onClick={() => setReceived(centsToInput(dueWithTip))}
              >
                Exacto
              </button>
            </div>
            <input
              id="rp-amt"
              type="text"
              inputMode="decimal"
              value={received}
              onChange={(e) => {
                setError(null);
                setReceived(e.target.value);
              }}
              required
              autoFocus
            />
          </div>
          {method === "tarjeta" && (
            <div className="az-field full">
              <label htmlFor="rp-folio">
                Folio de terminal <span className="font-normal text-muted-foreground">(opcional)</span>
              </label>
              <input
                id="rp-folio"
                type="text"
                value={terminalFolio}
                onChange={(e) => setTerminalFolio(e.target.value)}
                placeholder="Ej. 482910"
                maxLength={40}
              />
            </div>
          )}
        </div>

        <div className="grid gap-2">
          <span className="az-section-kicker">Propina reportada (opcional)</span>
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
              <label htmlFor="rp-tip-custom">
                {tipMode === "pct" ? "Porcentaje (%)" : "Monto de propina ($)"}
              </label>
              <input
                id="rp-tip-custom"
                type="text"
                inputMode="decimal"
                value={tipInput}
                onChange={(e) => setTipInput(e.target.value)}
                placeholder={tipMode === "pct" ? "12" : "50.00"}
              />
            </div>
          )}
        </div>

        <div className="az-field">
          <label htmlFor="rp-note">
            Nota para caja <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <input
            id="rp-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej. Pagó con billete de $500, necesita cambio"
            maxLength={160}
          />
        </div>

        {!Number.isNaN(receivedCents) && receivedCents > 0 && (
          <div className="az-totals">
            <div>
              <span>Total con propina</span>
              <span className="az-money">{formatMoney(dueWithTip, currencyCode)}</span>
            </div>
            {nonCashOver ? (
              <div className="text-destructive font-semibold">
                <span>Supera el total + propina</span>
                <span className="az-money">+{formatMoney(receivedCents - dueWithTip, currencyCode)}</span>
              </div>
            ) : diffCents > 0 ? (
              <div className="font-bold text-[#236a3a]">
                <span>Cambio a pedir en caja</span>
                <span className="az-money">{formatMoney(diffCents, currencyCode)}</span>
              </div>
            ) : diffCents < 0 ? (
              <div className="font-bold text-[#9b6011]">
                <span>Quedará faltando (abono parcial)</span>
                <span className="az-money">{formatMoney(Math.abs(diffCents), currencyCode)}</span>
              </div>
            ) : (
              <div className="font-bold text-[#236a3a]">
                <span>Pago exacto</span>
                <span className="az-money">$0.00</span>
              </div>
            )}
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
