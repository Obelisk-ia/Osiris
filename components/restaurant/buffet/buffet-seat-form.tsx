"use client";

import { useMutation } from "convex/react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage, formatMoney } from "@/lib/format";

export function BuffetSeatForm({ table, prices, currencyCode, onSeated }: {
  table: { _id: Id<"diningTables">; seatCount: number };
  prices: { adultCents: number; childCents: number | null };
  currencyCode: string;
  onSeated: (accountId: Id<"accounts">) => void;
}) {
  const seat = useMutation(api.waiter.seatBuffetParty);
  const requestId = useRef<string | null>(null);
  const [adults, setAdults] = useState("1");
  const [children, setChildren] = useState("0");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupSize = Number(adults) + Number(children);
  const childCents = prices.childCents ?? prices.adultCents;
  const total = Number(adults) * prices.adultCents + Number(children) * childCents;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || groupSize < 1 || groupSize > table.seatCount) return;
    setPending(true);
    setError(null);
    try {
      requestId.current ??= crypto.randomUUID();
      const accountId = await seat({ tableId: table._id, adults: Number(adults), children: Number(children), requestId: requestId.current });
      onSeated(accountId);
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos registrar el grupo."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
      <h2 className="text-base font-bold">Sentar grupo</h2>
      <div className="az-form-grid">
        <div className="az-field">
          <label htmlFor="buffet-seated-adults">Adultos</label>
          <input id="buffet-seated-adults" type="number" min={0} max={table.seatCount} step={1} required
            value={adults} disabled={pending} onChange={(event) => setAdults(event.target.value)} />
          <p className="text-sm text-muted-foreground">{formatMoney(prices.adultCents, currencyCode)} por adulto</p>
        </div>
        <div className="az-field">
          <label htmlFor="buffet-seated-children">Niños</label>
          <input id="buffet-seated-children" type="number" min={0} max={table.seatCount} step={1} required
            value={children} disabled={pending} onChange={(event) => setChildren(event.target.value)} />
          <p className="text-sm text-muted-foreground">{formatMoney(childCents, currencyCode)} por niño</p>
        </div>
      </div>
      <div className="az-totals">
        <div className="grand"><span>Entrada del grupo</span><output className="az-money">{formatMoney(total, currencyCode)}</output></div>
      </div>
      {groupSize > table.seatCount && <p role="alert" className="text-sm text-destructive">La mesa admite hasta {table.seatCount} personas.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="site-button min-h-11" disabled={pending || groupSize < 1 || groupSize > table.seatCount}>
        {pending ? "Registrando…" : "Confirmar grupo"}
      </Button>
    </form>
  );
}
