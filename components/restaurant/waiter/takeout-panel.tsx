"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { Check, ChevronRight, Info, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AdminModal, AdminPageHead, ToastBanner, useToast } from "@/components/restaurant/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { errorMessage, formatMoney } from "@/lib/format";

const STAGES = [
  { key: "nuevo", label: "Nuevo" },
  { key: "preparando", label: "Preparando" },
  { key: "listo", label: "Listo" },
  { key: "entregado", label: "Entregado" },
] as const;

const KIND_LABELS = {
  takeaway: "Para llevar",
  pickup: "Para recoger",
  counter: "Barra",
} as const;

export function TakeoutPanel({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.waiter.takeoutSnapshot>;
}) {
  const data = usePreloadedQuery(preloaded);
  const router = useRouter();
  const { toast, showToast } = useToast();

  const createTakeout = useMutation(api.waiter.createTakeoutAccount);
  const markDelivered = useMutation(api.waiter.markAccountDelivered);

  const [newOpen, setNewOpen] = useState(false);
  const [busyId, setBusyId] = useState<Id<"accounts"> | null>(null);

  const takeoutList = data.accounts.filter((a) => a.kind !== "counter");
  const counterList = data.accounts.filter((a) => a.kind === "counter");

  async function handleDeliver(accountId: Id<"accounts">) {
    setBusyId(accountId);
    try {
      await markDelivered({ accountId });
      showToast("Pedido marcado como entregado");
    } catch (cause) {
      showToast(errorMessage(cause), "err");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="az-page">
      <AdminPageHead
        index={2}
        total={2}
        restaurantName={data.restaurantName}
        locationName={data.locationName}
        title="Para llevar y para recoger"
        subtitle="Pedidos capturados por teléfono, mostrador o cuentas de barra sin mesa física."
        actions={
          <Button className="site-button" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Nueva cuenta sin mesa
          </Button>
        }
      />

      <div className="az-kanban">
        {STAGES.map((stage) => {
          const col = takeoutList.filter((acc) => acc.stage === stage.key);
          return (
            <section key={stage.key} className="az-kanban-col" aria-label={stage.label}>
              <div className="az-kanban-head">
                <span>{stage.label}</span>
                <span className="az-badge">{col.length}</span>
              </div>
              {col.length > 0 ? (
                col.map((acc) => (
                  <article key={acc._id} className="az-card !p-4 !gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <strong className="text-sm font-bold leading-snug">{acc.customerName}</strong>
                      <span className="az-badge">{KIND_LABELS[acc.kind]}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Folio A-{String(acc.folio).padStart(4, "0")}
                      {acc.customerPhone ? ` · ${acc.customerPhone}` : ""}
                    </p>
                    <p className="text-xs text-[#2a2620]">
                      {acc.hasItems ? acc.itemsSummary : <span className="text-muted-foreground">Sin productos todavía</span>}
                    </p>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <strong className="az-money text-sm">
                        {formatMoney(acc.totalCents, data.currencyCode)}
                      </strong>
                      {acc.state === "awaiting_payment" && (
                        <span className="az-badge warn">Por cobrar</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Link
                        href={`/cuenta/mesero/cuenta/${acc._id}`}
                        className="inline-flex items-center justify-center rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold hover:border-foreground"
                      >
                        Abrir
                      </Link>
                      {acc.hasUndelivered && (
                        <Button
                          type="button"
                          size="xs"
                          variant={acc.stage === "listo" ? "default" : "outline"}
                          className={acc.stage === "listo" ? "az-coral-cta" : undefined}
                          disabled={busyId === acc._id}
                          onClick={() => void handleDeliver(acc._id)}
                        >
                          <Check className="size-3.5" aria-hidden="true" />
                          Entregar
                        </Button>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <p className="text-xs italic text-muted-foreground py-2">Sin pedidos en este estado.</p>
              )}
            </section>
          );
        })}
      </div>

      {counterList.length > 0 && (
        <section className="grid gap-3 mt-4">
          <h2 className="font-heading text-xl font-bold">Cuentas de barra</h2>
          <ul className="az-rows">
            {counterList.map((acc) => (
              <li key={acc._id} className="!p-0">
                <Link href={`/cuenta/mesero/cuenta/${acc._id}`} className="az-row-link">
                  <span className="flex-1 min-w-0 truncate font-semibold text-sm">
                    Folio A-{String(acc.folio).padStart(4, "0")} · {acc.customerName}
                  </span>
                  <span className="az-money text-sm">
                    {formatMoney(acc.totalCents, data.currencyCode)}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {newOpen && (
        <NewTakeoutModal
          restaurantName={data.restaurantName}
          onClose={() => setNewOpen(false)}
          onCreate={async (payload) => {
            const accountId = await createTakeout(payload);
            setNewOpen(false);
            router.push(`/cuenta/mesero/cuenta/${accountId}`);
          }}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}

function NewTakeoutModal({
  restaurantName,
  onClose,
  onCreate,
}: {
  restaurantName: string;
  onClose: () => void;
  onCreate: (payload: {
    kind: "takeaway" | "pickup" | "counter";
    customerName?: string;
    customerPhone?: string;
    phoneConsent?: boolean;
  }) => Promise<void>;
}) {
  const [kind, setKind] = useState<"takeaway" | "pickup" | "counter">("takeaway");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (kind !== "counter") {
      if (!name.trim()) return setError("Escribe el nombre del cliente.");
      if (phone.trim()) {
        const digits = phone.replace(/\D/g, "");
        if (digits.length !== 10) return setError("Escribe un teléfono de 10 dígitos.");
        if (!consent) return setError("Marca el consentimiento para guardar el teléfono.");
      }
    }
    setPending(true);
    try {
      await onCreate({
        kind,
        customerName: name.trim() || undefined,
        customerPhone: phone.trim() || undefined,
        phoneConsent: phone.trim() ? consent : undefined,
      });
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos abrir la cuenta."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title="Nueva cuenta sin mesa"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="takeout-form" className="site-button" disabled={pending}>
            {pending ? "Abriendo…" : "Abrir cuenta"}
          </Button>
        </>
      }
    >
      <form id="takeout-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-form-grid">
          <div className="az-field">
            <label htmlFor="to-kind">Tipo</label>
            <select
              id="to-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as "takeaway" | "pickup" | "counter")}
            >
              <option value="takeaway">Para llevar</option>
              <option value="pickup">Para recoger</option>
              <option value="counter">Barra</option>
            </select>
          </div>
          <div className="az-field">
            <label htmlFor="to-name">
              Nombre del cliente {kind === "counter" ? "(opcional)" : ""}
            </label>
            <input
              id="to-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Andrea Solís"
              required={kind !== "counter"}
              autoFocus
            />
          </div>
          {kind !== "counter" && (
            <div className="az-field full">
              <label htmlFor="to-phone">Teléfono (opcional, 10 dígitos)</label>
              <input
                id="to-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="5512345678"
              />
            </div>
          )}
        </div>

        {kind !== "counter" && phone.trim().length > 0 && (
          <>
            <label className="az-check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span className="text-xs">
                El cliente da su consentimiento para guardar su nombre y teléfono ligados a este pedido.
              </span>
            </label>
            <div className="az-notice">
              <Info className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <strong>Aviso de privacidad.</strong> {restaurantName} usa estos datos solo para avisar sobre este
                pedido.
              </span>
            </div>
          </>
        )}

        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}
