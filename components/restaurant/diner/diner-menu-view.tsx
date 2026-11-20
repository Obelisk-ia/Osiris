"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import {
  Ban,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Lock,
  Receipt,
  Search,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { ConfirmModal, EmptyState, ToastBanner, useToast } from "@/components/restaurant/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { errorMessage, formatDateTime, formatMoney, toRoman } from "@/lib/format";

type TableSnapshot = NonNullable<ReturnType<typeof usePreloadedQuery<typeof api.diner.tableByQrToken>>>;
type DinerDish = Extract<TableSnapshot, { status: "ready" }>["dishes"][number];
type DinerCategory = Extract<TableSnapshot, { status: "ready" }>["categories"][number];

const ITEM_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  ordered: { label: "Enviado", cls: "" },
  preparing: { label: "Preparando", cls: "warn" },
  ready: { label: "Listo", cls: "success" },
  delivered: { label: "Entregado", cls: "success" },
};

function MenuCatalog({
  categories,
  dishes,
  currencyCode,
  buffetOnly,
}: {
  categories: readonly DinerCategory[];
  dishes: readonly DinerDish[];
  currencyCode: string;
  buffetOnly: boolean;
}) {
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dishes.filter((d) => {
      if (activeCat !== "all" && d.categoryId !== activeCat) return false;
      if (q && !d.name.toLowerCase().includes(q) && !d.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [dishes, search, activeCat]);

  const grouped = useMemo(() => {
    const sections: Array<{ id: string; name: string; items: DinerDish[] }> = [];
    for (const cat of categories) {
      const items = filtered.filter((d) => d.categoryId === cat._id);
      if (items.length > 0) sections.push({ id: String(cat._id), name: cat.name, items });
    }
    const uncategorized = filtered.filter((d) => !d.categoryId);
    if (uncategorized.length > 0) {
      sections.push({ id: "otros", name: "Especialidades", items: uncategorized });
    }
    return sections;
  }, [categories, filtered]);

  return (
    <div className="grid gap-6">
      <div className="az-toolbar">
        <div className="az-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar platillo o bebida"
            aria-label={buffetOnly ? "Buscar extras" : "Buscar en la carta"}
          />
        </div>
      </div>

      {categories.length > 0 && (
        <div className="az-chips" role="group" aria-label="Categorías del menú">
          <button
            type="button"
            className="az-chip"
            aria-pressed={activeCat === "all"}
            onClick={() => setActiveCat("all")}
          >
            Todo
          </button>
          {categories.map((cat) => (
            <button
              key={cat._id}
              type="button"
              className="az-chip"
              aria-pressed={activeCat === cat._id}
              onClick={() => setActiveCat(cat._id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {grouped.length > 0 ? (
        <div className="grid gap-8">
          {grouped.map((sec, idx) => (
            <section key={sec.id} className="grid gap-4" aria-label={sec.name}>
              <div className="flex items-baseline gap-2 border-b border-foreground pb-2">
                <span className="roman text-muted-foreground">{toRoman(idx + 1)}.</span>
                <h2 className="font-heading text-2xl font-extrabold tracking-tight">{sec.name}</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sec.items.map((dish) => (
                  <article
                    key={dish._id}
                    className={`az-card !p-0 overflow-hidden flex flex-col${dish.soldOut ? " opacity-65" : ""}`}
                  >
                    <div className="relative aspect-[4/3] w-full bg-[#e5dcc6] overflow-hidden">
                      {dish.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={dish.photoUrl}
                          alt={dish.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-muted-foreground">
                          <Utensils className="size-8" aria-hidden="true" />
                        </div>
                      )}
                      {dish.soldOut && (
                        <span className="az-badge danger absolute right-3 top-3 shadow-sm">
                          <Ban aria-hidden="true" />
                          Agotado
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-heading text-base font-bold leading-snug">{dish.name}</h3>
                        <span className="az-money text-sm shrink-0">
                          {formatMoney(dish.priceCents, currencyCode)}
                        </span>
                      </div>
                      {dish.description && (
                        <p className="text-xs text-[#2a2620] leading-relaxed">{dish.description}</p>
                      )}
                      {dish.modifierSummaries.length > 0 && (
                        <div className="mt-auto pt-2 border-t border-[#ddd2b6] grid gap-1">
                          {dish.modifierSummaries.map((mod) => (
                            <p key={mod.groupName} className="text-[11px] text-muted-foreground">
                              <strong className="text-foreground">{mod.groupName}:</strong>{" "}
                              {mod.options
                                .map((o) =>
                                  o.priceExtraCents > 0
                                    ? `${o.name} (+${formatMoney(o.priceExtraCents, currencyCode)})`
                                    : o.name,
                                )
                                .join(" · ")}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Utensils className="size-7" aria-hidden="true" />}
          title={dishes.length > 0 ? "Sin coincidencias" : buffetOnly ? "Sin extras disponibles" : "La carta aún se está preparando"}
          description={
            dishes.length === 0
              ? "Pide a tu mesero las recomendaciones del día."
              : "Prueba buscando con otro nombre o cambia de categoría."
          }
        />
      )}
    </div>
  );
}

export function PublicMenuView({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.diner.publicMenu>;
}) {
  const data = usePreloadedQuery(preloaded);

  if (data.status === "invalid") {
    return (
      <main className="site-wrap account-wrap">
        <div className="az-card max-w-md mx-auto text-center">
          <Lock className="size-8 mx-auto text-muted-foreground" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-extrabold">Carta no disponible</h1>
          <p className="text-sm text-muted-foreground">
            Este enlace ya no corresponde a una sucursal activa.
          </p>
        </div>
      </main>
    );
  }

  const buffetOnly = data.serviceMode === "buffet";

  return (
    <div className="relative min-h-svh overflow-x-clip">
      <div className="az-backdrop" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="az-backdrop-img" src="/collage/hathor.webp" alt="" />
      </div>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border bg-[#efe7d2ee] px-5 py-3.5 backdrop-blur-md">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="brand-mark" aria-hidden="true">Ø</span>
          <strong className="font-heading text-lg font-extrabold truncate">{data.restaurantName}</strong>
          <span className="text-xs text-muted-foreground truncate hidden sm:inline">
            · {data.locationName}
          </span>
        </div>
        <span className="az-badge">{buffetOnly ? "Buffet" : "Carta digital"}</span>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 py-8 pb-16 grid gap-6">
        <header className="az-page-head">
          <p className="restaurant-eyebrow">{data.restaurantName} · {data.locationName}</p>
          <h1 className="editorial-title">
            {buffetOnly ? <>Extras del <em>buffet</em></> : <>La <em>carta</em></>}<span className="coral-dot">.</span>
          </h1>
          <p>
            {buffetOnly ? "Consulta los productos que puedes pedir por separado." : "Consulta nuestros platillos, opciones y disponibilidad en vivo."}{" "}
            Para pedir o solicitar tu cuenta, escanea el código QR de tu mesa.
          </p>
        </header>

        <MenuCatalog
          categories={data.categories}
          dishes={data.dishes}
          currencyCode={data.currencyCode}
          buffetOnly={buffetOnly}
        />
      </main>
    </div>
  );
}

export function DinerTableView({
  qrToken,
  preloaded,
}: {
  qrToken: string;
  preloaded: Preloaded<typeof api.diner.tableByQrToken>;
}) {
  const data = usePreloadedQuery(preloaded);
  const callWaiter = useMutation(api.diner.callWaiter);
  const requestBill = useMutation(api.diner.requestBill);
  const { toast, showToast } = useToast();

  const [tab, setTab] = useState<"carta" | "mesa">("carta");
  const [calling, setCalling] = useState(false);
  const [requestingBill, setRequestingBill] = useState(false);
  const [confirmBillOpen, setConfirmBillOpen] = useState(false);

  if (data.status === "invalid") {
    return (
      <main className="site-wrap account-wrap">
        <div className="az-card max-w-md mx-auto text-center">
          <Lock className="size-8 mx-auto text-muted-foreground" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-extrabold">Este código ya no funciona</h1>
          <p className="text-sm text-muted-foreground">
            El código QR de esta mesa fue reemplazado o ya no está activo. Pide ayuda a tu mesero.
          </p>
        </div>
      </main>
    );
  }

  if (data.status === "paused") {
    return (
      <main className="site-wrap account-wrap">
        <div className="az-card max-w-md mx-auto text-center">
          <Lock className="size-8 mx-auto text-muted-foreground" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-extrabold">{data.restaurantName}</h1>
          <p className="text-sm text-muted-foreground">
            El código de esta mesa está pausado por el momento, pero puedes consultar nuestra carta.
          </p>
          <Link
            href={`/menu/${data.locationId}`}
            className="site-button inline-flex items-center justify-center bg-foreground text-card mx-auto"
          >
            <BookOpen className="size-4" aria-hidden="true" />
            Ver la carta
          </Link>
        </div>
      </main>
    );
  }

  const account = data.account;
  const admission = account?.buffetAdmission;
  const buffetOnly = data.serviceMode === "buffet";

  async function handleCallWaiter() {
    if (calling) return;
    setCalling(true);
    try {
      const res = await callWaiter({ qrToken });
      if (res.cooldown) {
        showToast("Tu mesero ya recibió el aviso. Viene en camino.");
      } else {
        showToast("Avisamos a tu mesero");
      }
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos enviar el aviso."), "err");
    } finally {
      setCalling(false);
    }
  }

  async function handleRequestBill() {
    if (requestingBill) return;
    setRequestingBill(true);
    try {
      await requestBill({ qrToken });
      setConfirmBillOpen(false);
      showToast("Listo, pedimos tu cuenta. Enseguida se acercará tu mesero.");
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos pedir la cuenta todavía."), "err");
    } finally {
      setRequestingBill(false);
    }
  }

  return (
    <div className="relative min-h-svh overflow-x-clip pb-24">
      <div className="az-backdrop" aria-hidden="true">
        {/* Hathor is the guest/hospitality goddess in Atelier Zero */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="az-backdrop-img" src="/collage/hathor.webp" alt="" />
      </div>

      <header className="sticky top-0 z-20 border-b border-border bg-[#efe7d2f0] backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="brand-mark" aria-hidden="true">Ø</span>
              <strong className="font-heading text-lg font-extrabold truncate">
                {data.restaurantName}
              </strong>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {data.table.tableNumber} · {data.table.sectionName} · {data.locationName}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={calling}
            onClick={() => void handleCallWaiter()}
          >
            <Bell className="size-3.5" aria-hidden="true" />
            {calling ? "Avisando…" : "Llamar mesero"}
          </Button>
        </div>

        <div className="mx-auto max-w-5xl px-5">
          <div className="az-tabs !border-b-0" role="tablist" aria-label="Secciones del comensal">
            <button
              type="button"
              role="tab"
              className="az-tab"
              aria-selected={tab === "carta"}
              onClick={() => setTab("carta")}
            >
              <BookOpen className="size-4" aria-hidden="true" />
              <span>{buffetOnly ? "Extras" : "La carta"}</span>
            </button>
            <button
              type="button"
              role="tab"
              className="az-tab"
              aria-selected={tab === "mesa"}
              onClick={() => setTab("mesa")}
            >
              <Receipt className="size-4" aria-hidden="true" />
              <span>Mi mesa</span>
              {account && account.totalUnits > 0 && (
                <span className="az-count">{account.totalUnits}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 py-7 grid gap-6">
        {tab === "carta" && (
          <>
            <header className="az-page-head">
              <p className="restaurant-eyebrow">
                {data.table.tableNumber} · {data.table.sectionName}
              </p>
              <h1 className="editorial-title">
                {buffetOnly ? <>Extras del <em>buffet</em></> : <>La <em>carta</em></>}<span className="coral-dot">.</span>
              </h1>
              <p>
                {buffetOnly ? "Pide estos extras por separado con tu mesero." : "Explora el menú en vivo y llama a tu mesero cuando estés listo para ordenar."}
              </p>
            </header>

            <MenuCatalog
              categories={data.categories}
              dishes={data.dishes}
              currencyCode={data.currencyCode}
              buffetOnly={buffetOnly}
            />
          </>
        )}

        {tab === "mesa" && (
          <div className="grid gap-5 max-w-2xl">
            <header className="az-page-head">
              <p className="restaurant-eyebrow">
                {data.table.tableNumber}
                {account ? ` · Folio A-${String(account.folio).padStart(4, "0")}` : ""}
              </p>
              <h1 className="editorial-title">
                Tu <em>mesa</em><span className="coral-dot">.</span>
              </h1>
            </header>

            <div className="az-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-heading text-lg font-bold">Acciones de servicio</h2>
                {account?.state === "awaiting_payment" ? (
                  <span className="az-badge warn">
                    <Receipt aria-hidden="true" />
                    Cuenta solicitada
                  </span>
                ) : account && account.canRequestBill ? (
                  <span className="az-badge success">
                    <Check aria-hidden="true" />
                    {admission && account.totalUnits === 0 ? "Entrada registrada" : "Todo entregado"}
                  </span>
                ) : account ? (
                  <span className="az-badge">
                    <Clock aria-hidden="true" />
                    {account.deliveredUnits} de {account.totalUnits} entregados
                  </span>
                ) : (
                  <span className="az-badge">Sin orden todavía</span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  disabled={calling}
                  onClick={() => void handleCallWaiter()}
                >
                  <Bell className="size-4" aria-hidden="true" />
                  {calling ? "Avisando…" : "Llamar al mesero"}
                </Button>

                {account?.state === "awaiting_payment" ? (
                  <Button type="button" variant="outline" disabled>
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    Cuenta solicitada
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className={account?.canRequestBill ? "site-button az-coral-cta" : ""}
                    variant={account?.canRequestBill ? "default" : "outline"}
                    disabled={!account?.canRequestBill || requestingBill}
                    onClick={() => setConfirmBillOpen(true)}
                  >
                    {account?.canRequestBill ? (
                      <Receipt className="size-4" aria-hidden="true" />
                    ) : (
                      <Lock className="size-4" aria-hidden="true" />
                    )}
                    Pedir la cuenta
                  </Button>
                )}
              </div>

              {account?.state === "awaiting_payment" ? (
                <div className="az-notice warn">
                  <Receipt className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Ya pediste la cuenta. Tu mesero y Caja fueron avisados; enseguida se acercarán
                    a tu mesa para realizar el cobro.
                  </span>
                </div>
              ) : !account ? (
                <div className="az-notice">
                  <Lock className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    El botón <strong>Pedir la cuenta</strong> se desbloquea cuando tu mesero tome tu
                    orden y recibas todos tus platillos.
                  </span>
                </div>
              ) : !account.canRequestBill && account.billLockReason ? (
                <div className="az-notice">
                  <Lock className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{account.billLockReason}</span>
                </div>
              ) : (
                <div className="az-notice ok">
                  <Check className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    {admission && account?.totalUnits === 0 ? "La entrada de tu grupo está registrada." : "Todos tus platillos ya fueron entregados."}{" Cuando gustes, toca "}
                    <strong>Pedir la cuenta</strong> para avisar a tu mesero y a Caja.
                  </span>
                </div>
              )}
            </div>

            {account && (account.items.length > 0 || admission) ? (
              <section className="az-card" aria-label="Consumo de la mesa">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-heading text-lg font-bold">{admission ? "Consumo de la mesa" : "Lo que pidieron"}</h2>
                  <span className="text-xs text-muted-foreground">
                    Abierta {formatDateTime(account.openedAt)}
                  </span>
                </div>

                <div className="az-lines">
                  {admission && (
                    <div className="az-line">
                      <div className="az-line-text">
                        <strong>Entrada de buffet</strong>
                        <span className="text-sm text-muted-foreground">{admission.adults} adultos · {admission.children} niños</span>
                      </div>
                      <span className="az-money">{formatMoney(admission.adults * admission.adultCents + admission.children * admission.childCents, data.currencyCode)}</span>
                    </div>
                  )}
                  {account.items.map((item) => {
                    const st = ITEM_STATUS_LABELS[item.status] ?? { label: item.status, cls: "" };
                    return (
                      <div key={item._id} className="az-line">
                        <div className="az-line-text">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">
                              {item.quantity} × {item.dishName}
                            </span>
                            <span className={`az-badge ${st.cls}`}>
                              {item.deliveredQuantity > 0 && item.deliveredQuantity < item.quantity
                                ? `${item.deliveredQuantity}/${item.quantity} entregados`
                                : st.label}
                            </span>
                          </div>
                          {item.modifiersText && (
                            <span className="text-xs text-muted-foreground">
                              {item.modifiersText}
                            </span>
                          )}
                          {item.comments && (
                            <span className="text-xs text-muted-foreground">
                              Nota: {item.comments}
                            </span>
                          )}
                        </div>
                        <span className="az-money text-sm">
                          {formatMoney(item.lineTotalCents, data.currencyCode)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="az-totals">
                  {account.discountCents > 0 && (
                    <div className="text-xs text-[#236a3a]">
                      <span>
                        Descuento{account.discountReason ? ` (${account.discountReason})` : ""}
                      </span>
                      <span>−{formatMoney(account.discountCents, data.currencyCode)}</span>
                    </div>
                  )}
                  <div className="grand">
                    <span>Total</span>
                    <span className="az-money">
                      {formatMoney(account.totalCents, data.currencyCode)}
                    </span>
                  </div>
                  {account.paidCents > 0 && (
                    <>
                      <div className="text-xs text-muted-foreground">
                        <span>Pagado</span>
                        <span>{formatMoney(account.paidCents, data.currencyCode)}</span>
                      </div>
                      <div className="font-bold">
                        <span>Restante</span>
                        <span className="az-money">
                          {formatMoney(account.balanceCents, data.currencyCode)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </section>
            ) : (
              <EmptyState
                icon={<Utensils className="size-7" aria-hidden="true" />}
                title="Tu mesa está lista"
                description="Revisa la carta y cuando gustes llama a tu mesero para tomar tu orden."
                action={
                  <Button
                    type="button"
                    className="site-button mt-2"
                    onClick={() => setTab("carta")}
                  >
                    <BookOpen className="size-4" aria-hidden="true" />
                    Ver la carta
                  </Button>
                }
              />
            )}
          </div>
        )}
      </main>

      {account && tab === "carta" && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-foreground bg-[#efe7d2f5] px-4 py-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="min-w-0">
              <strong className="block text-sm font-bold truncate">
                {data.table.tableNumber} · {formatMoney(account.totalCents, data.currencyCode)}
              </strong>
              <span className="block text-xs text-muted-foreground truncate">
                {account.state === "awaiting_payment"
                  ? "Cuenta solicitada"
                  : account.canRequestBill
                    ? admission && account.totalUnits === 0 ? "Entrada registrada · Puedes pedir la cuenta" : "Todos tus platillos entregados · Puedes pedir la cuenta"
                    : `${account.deliveredUnits} de ${account.totalUnits} platillos entregados`}
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              className={account.canRequestBill ? "site-button az-coral-cta !min-h-[38px]" : ""}
              variant={account.canRequestBill ? "default" : "outline"}
              onClick={() => setTab("mesa")}
            >
              {account.canRequestBill ? "Pedir la cuenta" : "Ver mi mesa"}
            </Button>
          </div>
        </div>
      )}

      {confirmBillOpen && account && (
        <ConfirmModal
          title="¿Pedir la cuenta?"
          message={`Total actual: ${formatMoney(account.totalCents, data.currencyCode)}. Avisaremos a tu mesero y a Caja para que se acerquen a ${data.table.tableNumber}.`}
          confirmLabel="Sí, pedir la cuenta"
          pending={requestingBill}
          onConfirm={() => void handleRequestBill()}
          onClose={() => setConfirmBillOpen(false)}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}
