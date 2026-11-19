"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { Calendar, Check, Edit3, Info, Plus, Power, Search, Trash2, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { errorMessage, formatIsoDateLabel, formatMoney, todayIsoDate } from "@/lib/format";
import { AdminModal, AdminPageHead, ConfirmModal, EmptyState, ToastBanner, useToast } from "./admin-ui";

type Snapshot = NonNullable<ReturnType<typeof usePreloadedQuery<typeof api.buffet.snapshot>>>;
type BuffetMenu = Snapshot["menus"][number];
type DishOption = Snapshot["availableDishes"][number];

export function BuffetPanel({ preloaded }: { preloaded: Preloaded<typeof api.buffet.snapshot> }) {
  const data = usePreloadedQuery(preloaded);
  const { toast, showToast } = useToast();

  const createMenu = useMutation(api.buffet.createMenu);
  const updateMenu = useMutation(api.buffet.updateMenu);
  const toggleMenuActive = useMutation(api.buffet.toggleMenuActive);
  const removeMenu = useMutation(api.buffet.removeMenu);

  const [modal, setModal] = useState<{ open: true; menu?: BuffetMenu } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BuffetMenu | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      await removeMenu({ menuId: deleteTarget._id });
      showToast("Menú de buffet eliminado");
      setDeleteTarget(null);
    } catch (cause) {
      showToast(errorMessage(cause), "err");
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="az-page">
      <AdminPageHead
        index={4}
        total={8}
        restaurantName={data.restaurantName}
        locationName={data.locationName}
        title="Menús de buffet"
        subtitle="Arma la selección de platillos del buffet por fecha. Cuando se integre cocina y salón, los lotes y comensales usarán estos menús."
        actions={
          <Button className="site-button" onClick={() => setModal({ open: true })}>
            <Plus className="size-4" aria-hidden="true" />
            Nuevo menú de buffet
          </Button>
        }
      />

      {data.serviceMode === "a_la_carte" && (
        <div className="az-notice warn">
          <Info className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Esta sucursal está configurada solo como <strong>A la carta</strong>. Puedes activar el modo{" "}
            <strong>Buffet</strong> o <strong>Mixto</strong> en{" "}
            <Link href="/cuenta/administracion/caracteristicas" className="underline font-semibold">
              Características
            </Link>
            .
          </span>
        </div>
      )}

      {data.menus.length > 0 ? (
        <ul className="az-rows">
          {data.menus.map((menu) => (
            <li key={menu._id}>
              <div className="az-row-main">
                <div className="az-row-text">
                  <div className="az-cluster">
                    <strong className="text-[15px]">{menu.name}</strong>
                    <span className={`az-badge ${menu.isActive ? "success" : ""}`}>
                      {menu.isActive ? (
                        <>
                          <Check aria-hidden="true" />
                          Activo
                        </>
                      ) : (
                        "Inactivo"
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="size-3.5" aria-hidden="true" />
                    {formatIsoDateLabel(menu.menuDate)} · {menu.dishes.length}{" "}
                    {menu.dishes.length === 1 ? "platillo" : "platillos"}
                  </p>
                  {menu.dishes.length > 0 ? (
                    <div className="az-cluster mt-1.5">
                      {menu.dishes.map((dish) => (
                        <span key={dish.dishId} className="az-badge">
                          {dish.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">Sin platillos asignados todavía.</p>
                  )}
                </div>
                <div className="az-row-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await toggleMenuActive({ menuId: menu._id });
                        showToast(menu.isActive ? "Menú desactivado" : "Menú activado");
                      } catch (cause) {
                        showToast(errorMessage(cause), "err");
                      }
                    }}
                  >
                    <Power className="size-3.5" aria-hidden="true" />
                    {menu.isActive ? "Desactivar" : "Activar"}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Editar ${menu.name}`}
                    onClick={() => setModal({ open: true, menu })}
                  >
                    <Edit3 aria-hidden="true" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Borrar ${menu.name}`}
                    onClick={() => setDeleteTarget(menu)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<UtensilsCrossed className="size-7" aria-hidden="true" />}
          title="Sin menús de buffet"
          description="Crea tu primer menú de buffet para una fecha y selecciona los platillos que lo componen."
          action={
            <Button className="site-button mt-2" onClick={() => setModal({ open: true })}>
              <Plus className="size-4" aria-hidden="true" />
              Crear menú de buffet
            </Button>
          }
        />
      )}

      {modal && (
        <BuffetMenuModal
          menu={modal.menu}
          availableDishes={data.availableDishes}
          currencyCode={data.currencyCode}
          onClose={() => setModal(null)}
          onSave={async (payload) => {
            if (modal.menu) {
              await updateMenu({ menuId: modal.menu._id, ...payload });
              showToast("Menú de buffet actualizado");
            } else {
              await createMenu(payload);
              showToast("Menú de buffet creado");
            }
            setModal(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Borrar ${deleteTarget.name}`}
          message="Se quitará este menú de buffet y su selección de platillos."
          confirmLabel="Borrar menú"
          danger
          pending={deletePending}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}

function BuffetMenuModal({
  menu,
  availableDishes,
  currencyCode,
  onClose,
  onSave,
}: {
  menu?: BuffetMenu;
  availableDishes: DishOption[];
  currencyCode: string;
  onClose: () => void;
  onSave: (payload: {
    name: string;
    menuDate: string;
    isActive: boolean;
    dishIds: Id<"dishes">[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState(menu?.name ?? "");
  const [menuDate, setMenuDate] = useState(menu?.menuDate ?? todayIsoDate());
  const [isActive, setIsActive] = useState(menu?.isActive ?? true);
  const [selectedIds, setSelectedIds] = useState<Id<"dishes">[]>(() =>
    menu ? menu.dishes.map((d) => d.dishId) : [],
  );
  const [dishSearch, setDishSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selectedSet = new Set(selectedIds);
  const q = dishSearch.trim().toLowerCase();
  const visibleDishes = availableDishes.filter(
    (d) =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      (d.categoryName ?? "").toLowerCase().includes(q),
  );

  function toggleDish(id: Id<"dishes">) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Escribe el nombre del menú.");
    if (!menuDate) return setError("Elige la fecha del buffet.");
    setPending(true);
    try {
      await onSave({ name: name.trim(), menuDate, isActive, dishIds: selectedIds });
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos guardar el menú de buffet."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={menu ? `Editar ${menu.name}` : "Nuevo menú de buffet"}
      wide
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="buffet-form" className="site-button" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <form id="buffet-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-form-grid">
          <div className="az-field">
            <label htmlFor="buf-name">Nombre</label>
            <input
              id="buf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Buffet dominical, Desayuno…"
              required
              autoFocus
            />
          </div>
          <div className="az-field">
            <label htmlFor="buf-date">Fecha</label>
            <input
              id="buf-date"
              type="date"
              value={menuDate}
              onChange={(e) => setMenuDate(e.target.value)}
              required
            />
          </div>
        </div>

        <label className="az-check">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>Activo para esta fecha</span>
        </label>

        <section className="grid gap-3 border-t border-[#ddd2b6] pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-sm font-bold">
              Platillos incluidos ({selectedIds.length})
            </h3>
          </div>
          {availableDishes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Todavía no hay platillos en el menú.{" "}
              <Link href="/cuenta/administracion/menu" className="underline">
                Crea platillos en Menú
              </Link>{" "}
              para incluirlos en tu buffet.
            </p>
          ) : (
            <>
              <div className="az-search">
                <Search aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Filtrar platillos…"
                  value={dishSearch}
                  onChange={(e) => setDishSearch(e.target.value)}
                />
              </div>
              <div className="grid gap-1 max-h-60 overflow-y-auto pr-1">
                {visibleDishes.map((dish) => (
                  <label
                    key={dish._id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-2.5 py-2 hover:bg-black/5 cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        className="size-4 accent-[#15140f]"
                        checked={selectedSet.has(dish._id)}
                        onChange={() => toggleDish(dish._id)}
                      />
                      <span className="truncate text-sm font-medium">{dish.name}</span>
                      {dish.categoryName && (
                        <span className="text-xs text-muted-foreground">· {dish.categoryName}</span>
                      )}
                    </span>
                    <span className="az-money text-xs text-muted-foreground">
                      {formatMoney(dish.priceCents, currencyCode)}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </section>

        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}
