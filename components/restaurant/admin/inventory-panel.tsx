"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import {
  AlertTriangle,
  ArchiveRestore,
  Ban,
  Check,
  Copy,
  Edit3,
  Info,
  Package,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  centsToInput,
  errorMessage,
  formatDateTime,
  formatMoney,
  formatQty,
  formatSignedQty,
  fromMicros,
  MICROS_PER_UNIT,
  parseMoneyCents,
  toMicros,
  UNIT_LABELS,
  UNIT_SHORT,
  type InventoryUnit,
} from "@/lib/format";
import { AdminModal, AdminPageHead, ConfirmModal, EmptyState, ToastBanner, useToast } from "./admin-ui";

type Snapshot = NonNullable<ReturnType<typeof usePreloadedQuery<typeof api.inventory.snapshot>>>;
type Item = Snapshot["items"][number];

type TabKey = "stock" | "compras" | "movs";
type FilterKey = "all" | "normal" | "low" | "out" | "negative";

const INVENTORY_CATEGORIES = [
  "Carnes",
  "Pescados y mariscos",
  "Verduras y frutas",
  "Lácteos y huevo",
  "Panadería y granos",
  "Abarrotes y secos",
  "Salsas y condimentos",
  "Bebidas y barra",
  "Postres y repostería",
  "Desechables y limpieza",
  "General",
] as const;

const STATUS_META = {
  normal: { label: "Normal", cls: "success", icon: Check },
  low: { label: "Bajo", cls: "warn", icon: AlertTriangle },
  out: { label: "Agotado", cls: "danger", icon: Ban },
  negative: { label: "Negativo", cls: "danger", icon: AlertTriangle },
} as const;

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Entrada",
  consumption: "Consumo por receta",
  waste: "Merma",
  adjustment: "Ajuste",
  transfer_in: "Traspaso (entrada)",
  transfer_out: "Traspaso (salida)",
};

function normalizeName(name: string) {
  return name
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function purchaseSuggestion(item: Item) {
  const targetMicros = item.minMicros > 0 ? item.minMicros : item.factorMicros;
  const needMicros = Math.max(0, targetMicros - item.stockMicros);
  const units = item.factorMicros > 0 ? Math.max(1, Math.ceil(needMicros / item.factorMicros)) : 1;
  return {
    units,
    totalMicros: units * item.factorMicros,
  };
}

export function InventoryPanel({ preloaded }: { preloaded: Preloaded<typeof api.inventory.snapshot> }) {
  const data = usePreloadedQuery(preloaded);
  const { toast, showToast } = useToast();

  const createItem = useMutation(api.inventory.createItem);
  const updateItem = useMutation(api.inventory.updateItem);
  const removeItem = useMutation(api.inventory.removeItem);
  const restoreItem = useMutation(api.inventory.restoreItem);
  const recordEntry = useMutation(api.inventory.recordEntry);
  const recordAdjustment = useMutation(api.inventory.recordAdjustment);

  const [tab, setTab] = useState<TabKey>("stock");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [moveItemId, setMoveItemId] = useState<string>("all");

  const [itemDialog, setItemDialog] = useState<{ open: true; item?: Item } | null>(null);
  const [entryDialog, setEntryDialog] = useState<{ open: true; itemId?: Id<"inventoryItems">; presetUnits?: number } | null>(null);
  const [adjustDialog, setAdjustDialog] = useState<Item | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  const activeItems = data.items.filter((item) => item.isActive);
  const archivedItems = data.items.filter((item) => !item.isActive);
  const lowItems = activeItems.filter((item) => item.status !== "normal");

  const query = search.trim().toLowerCase();
  const filteredItems = activeItems.filter((item) => {
    if (filter !== "all" && item.status !== filter) return false;
    if (query && !item.name.toLowerCase().includes(query) && !item.category.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });

  const filteredMovements = data.movements.filter(
    (mov) => moveItemId === "all" || mov.inventoryItemId === moveItemId,
  );

  function buyText(items: Item[]) {
    return items
      .map((item) => {
        const s = purchaseSuggestion(item);
        return `${item.name}: ${s.units} × ${item.presentation} (${formatQty(s.totalMicros, item.unit)})`;
      })
      .join("\n");
  }

  async function copyToClipboard(text: string, okLabel: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(okLabel);
    } catch {
      showToast("No pudimos copiar al portapapeles.", "err");
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setConfirmPending(true);
    try {
      const wasUsed = deleteTarget.usedInRecipe;
      await removeItem({ inventoryItemId: deleteTarget._id });
      showToast(wasUsed ? "Insumo archivado" : "Insumo eliminado");
      setDeleteTarget(null);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos completar la acción."), "err");
    } finally {
      setConfirmPending(false);
    }
  }

  return (
    <div className="az-page">
      <AdminPageHead
        index={2}
        total={8}
        restaurantName={data.restaurantName}
        locationName={data.locationName}
        title="Inventario"
        subtitle="La existencia es la suma de los movimientos. Las recetas del menú se vinculan directamente a estos insumos."
        actions={
          <Button
            className="site-button"
            disabled={activeItems.length === 0}
            onClick={() => setEntryDialog({ open: true, itemId: activeItems[0]?._id })}
          >
            <Plus className="size-4" aria-hidden="true" />
            Registrar entrada
          </Button>
        }
      />

      <div className="az-tabs" role="tablist" aria-label="Secciones de inventario">
        <button type="button" className="az-tab" role="tab" aria-selected={tab === "stock"} onClick={() => setTab("stock")}>
          Existencias
        </button>
        <button type="button" className="az-tab" role="tab" aria-selected={tab === "compras"} onClick={() => setTab("compras")}>
          Lista de compras
          {lowItems.length > 0 && <span className="az-count">{lowItems.length}</span>}
        </button>
        <button type="button" className="az-tab" role="tab" aria-selected={tab === "movs"} onClick={() => setTab("movs")}>
          Movimientos
        </button>
      </div>

      {tab === "stock" && (
        <div className="grid gap-4">
          <div className="az-toolbar">
            <div className="az-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                placeholder="Buscar insumo o categoría"
                aria-label="Buscar insumo"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={() => setItemDialog({ open: true })}>
              <Plus className="size-4" aria-hidden="true" />
              Nuevo insumo
            </Button>
          </div>

          <div className="az-chips" role="group" aria-label="Filtrar existencias">
            {(
              [
                ["all", "Todos"],
                ["normal", "Normal"],
                ["low", "Bajo"],
                ["out", "Agotado"],
                ["negative", "Negativo"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="az-chip"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {filteredItems.length > 0 ? (
            <ul className="az-rows">
              {filteredItems.map((item) => {
                const meta = STATUS_META[item.status];
                const StatusIcon = meta.icon;
                return (
                  <li key={item._id}>
                    <div className="az-row-main">
                      <div className="az-row-text">
                        <div className="az-cluster">
                          <strong className="text-[15px]">{item.name}</strong>
                          <span className={`az-badge ${meta.cls}`}>
                            <StatusIcon aria-hidden="true" />
                            {meta.label}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          <strong className="text-foreground">{formatQty(item.stockMicros, item.unit)}</strong>
                          {item.minMicros > 0 ? ` · Mínimo ${formatQty(item.minMicros, item.unit)}` : ""} · {item.category}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.lastCostCents > 0
                            ? `Último costo ${formatMoney(item.lastCostCents, data.currencyCode)} por ${item.presentation.toLowerCase()}`
                            : `${item.presentation} (${formatQty(item.factorMicros, item.unit)})`}
                        </p>
                      </div>
                      <div className="az-row-actions">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEntryDialog({ open: true, itemId: item._id })}
                        >
                          Entrada
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setAdjustDialog(item)}>
                          Ajuste
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Editar ${item.name}`}
                          onClick={() => setItemDialog({ open: true, item })}
                        >
                          <Edit3 aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Archivar o borrar ${item.name}`}
                          onClick={() => setDeleteTarget(item)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<Package className="size-7" aria-hidden="true" />}
              title={activeItems.length === 0 ? "Sin insumos todavía" : "Sin insumos en este filtro"}
              description={
                activeItems.length === 0
                  ? "Crea tus primeros ingredientes o suministros para controlar existencias y armar recetas en el menú."
                  : "Prueba con otro filtro o búsqueda."
              }
              action={
                activeItems.length === 0 ? (
                  <Button className="site-button mt-2" onClick={() => setItemDialog({ open: true })}>
                    <Plus className="size-4" aria-hidden="true" />
                    Agregar primer insumo
                  </Button>
                ) : undefined
              }
            />
          )}

          {archivedItems.length > 0 && (
            <section className="grid gap-3 mt-4">
              <h2 className="font-heading text-lg font-bold">Archivados</h2>
              <ul className="az-rows">
                {archivedItems.map((item) => (
                  <li key={item._id}>
                    <div className="az-row-main">
                      <div className="az-row-text">
                        <strong>{item.name}</strong>
                        <span className="text-xs text-muted-foreground">Se conserva su historial de movimientos</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await restoreItem({ inventoryItemId: item._id });
                            showToast("Insumo restaurado");
                          } catch (cause) {
                            showToast(errorMessage(cause), "err");
                          }
                        }}
                      >
                        <ArchiveRestore className="size-4" aria-hidden="true" />
                        Restaurar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === "compras" && (
        <div className="grid gap-4">
          {lowItems.length === 0 ? (
            <EmptyState
              icon={<Check className="size-7" aria-hidden="true" />}
              title="Todo arriba del mínimo"
              description="Cuando un insumo llegue a cero o baje de su mínimo aparecerá aquí para reponerlo."
            />
          ) : (
            <>
              <div className="az-row-main">
                <p className="az-row-text text-sm text-muted-foreground">
                  Insumos agotados o por debajo de su mínimo de alerta.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyToClipboard(buyText(lowItems), "Lista de compras copiada")}
                >
                  <Copy className="size-4" aria-hidden="true" />
                  Copiar como texto
                </Button>
              </div>
              <ul className="az-rows">
                {lowItems.map((item) => {
                  const meta = STATUS_META[item.status];
                  const StatusIcon = meta.icon;
                  const s = purchaseSuggestion(item);
                  return (
                    <li key={item._id}>
                      <div className="az-row-main">
                        <div className="az-row-text">
                          <div className="az-cluster">
                            <strong>{item.name}</strong>
                            <span className={`az-badge ${meta.cls}`}>
                              <StatusIcon aria-hidden="true" />
                              {meta.label}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Hay {formatQty(item.stockMicros, item.unit)}
                            {item.minMicros > 0 ? ` · Mínimo ${formatQty(item.minMicros, item.unit)}` : ""}
                          </p>
                          <p className="text-sm mt-1">
                            Sugerido:{" "}
                            <strong>
                              {s.units} × {item.presentation}
                            </strong>{" "}
                            = {formatQty(s.totalMicros, item.unit)}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setEntryDialog({ open: true, itemId: item._id, presetUnits: s.units })
                          }
                        >
                          Registrar entrada
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === "movs" && (
        <div className="grid gap-4">
          <div className="az-field max-w-xs">
            <label htmlFor="move-filter">Filtrar por insumo</label>
            <select
              id="move-filter"
              value={moveItemId}
              onChange={(e) => setMoveItemId(e.target.value)}
            >
              <option value="all">Todos los insumos</option>
              {data.items.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          {filteredMovements.length > 0 ? (
            <ul className="az-rows">
              {filteredMovements.map((mov) => (
                <li key={mov._id}>
                  <div className="az-row-main">
                    <div className="az-row-text">
                      <strong>{mov.itemName}</strong>
                      <p className="text-sm text-muted-foreground">
                        {MOVEMENT_LABELS[mov.kind] ?? mov.kind}
                        {mov.reason ? ` · ${mov.reason}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {mov.createdByName} · {formatDateTime(mov._creationTime)}
                      </p>
                    </div>
                    <strong className="az-money text-sm">
                      {formatSignedQty(mov.quantityDeltaMicros, mov.unit)}
                    </strong>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Package className="size-7" aria-hidden="true" />}
              title="Sin movimientos"
              description="Las entradas, ajustes y consumos aparecerán aquí en orden cronológico."
            />
          )}
        </div>
      )}

      {itemDialog && (
        <SupplyModal
          item={itemDialog.item}
          existingItems={data.items}
          onClose={() => setItemDialog(null)}
          onSave={async (payload) => {
            if (itemDialog.item) {
              await updateItem({ inventoryItemId: itemDialog.item._id, ...payload });
              showToast("Insumo actualizado");
            } else {
              const res = await createItem(payload);
              if (res.merged) {
                showToast(
                  res.addedMicros > 0
                    ? `Se sumaron ${formatQty(res.addedMicros, res.unit)} a ${res.itemName} (ahora ${formatQty(res.newStockMicros, res.unit)})`
                    : `${res.itemName} ya estaba en tu inventario`,
                );
              } else {
                showToast("Insumo creado");
              }
            }
            setItemDialog(null);
          }}
        />
      )}

      {entryDialog && (
        <EntryModal
          items={activeItems}
          currencyCode={data.currencyCode}
          initialItemId={entryDialog.itemId}
          presetUnits={entryDialog.presetUnits}
          onClose={() => setEntryDialog(null)}
          onSave={async (payload) => {
            await recordEntry(payload);
            showToast("Entrada registrada");
            setEntryDialog(null);
          }}
        />
      )}

      {adjustDialog && (
        <AdjustModal
          item={adjustDialog}
          onClose={() => setAdjustDialog(null)}
          onSave={async (payload) => {
            await recordAdjustment({ inventoryItemId: adjustDialog._id, ...payload });
            showToast("Ajuste registrado");
            setAdjustDialog(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={deleteTarget.usedInRecipe ? `Archivar ${deleteTarget.name}` : `Borrar ${deleteTarget.name}`}
          message={
            deleteTarget.usedInRecipe
              ? "Este insumo se usa en una receta o tiene historial, así que se archivará y conservará sus movimientos."
              : "Este insumo se quitará del catálogo (si ya tiene movimientos registrados, se archivará)."
          }
          confirmLabel={deleteTarget.usedInRecipe ? "Archivar" : "Borrar"}
          danger={!deleteTarget.usedInRecipe}
          pending={confirmPending}
          onConfirm={() => void handleConfirmDelete()}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}

function SupplyModal({
  item,
  existingItems,
  onClose,
  onSave,
}: {
  item?: Item;
  existingItems: Item[];
  onClose: () => void;
  onSave: (payload: {
    name: string;
    unit: InventoryUnit;
    category: string;
    minMicros?: number;
    presentation: string;
    factorMicros: number;
    initialMicros?: number;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? INVENTORY_CATEGORIES[0]);
  const [unit, setUnit] = useState<InventoryUnit>(item?.unit ?? "g");
  const [minText, setMinText] = useState(item && item.minMicros > 0 ? String(fromMicros(item.minMicros)) : "");
  const [presentation, setPresentation] = useState(item?.presentation ?? "");
  const [factorText, setFactorText] = useState(item ? String(fromMicros(item.factorMicros)) : "");
  const [initialText, setInitialText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const matchedExisting = !item && name.trim()
    ? existingItems.find((other) => normalizeName(other.name) === normalizeName(name)) ?? null
    : null;

  const effectiveUnit = matchedExisting ? matchedExisting.unit : unit;

  const categoryOptions: string[] = [...INVENTORY_CATEGORIES];
  if (item?.category && !categoryOptions.includes(item.category)) {
    categoryOptions.unshift(item.category);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Escribe el nombre del insumo.");

    const initialMicros = item ? undefined : toMicros(initialText.trim() || "0");
    if (!item && (Number.isNaN(initialMicros) || (initialMicros ?? 0) < 0)) {
      return setError("La cantidad no puede ser negativa.");
    }

    // If adding to an existing supply, we only need a valid amount to add;
    // reuse its existing metadata automatically so it feels effortless.
    if (matchedExisting) {
      if (!initialMicros || initialMicros <= 0) {
        return setError(`Escribe cuánta cantidad en ${UNIT_SHORT[matchedExisting.unit]} quieres sumar a ${matchedExisting.name}.`);
      }
      setPending(true);
      try {
        await onSave({
          name: matchedExisting.name,
          unit: matchedExisting.unit,
          category: matchedExisting.category,
          minMicros: matchedExisting.minMicros,
          presentation: matchedExisting.presentation,
          factorMicros: matchedExisting.factorMicros,
          initialMicros,
        });
      } catch (cause) {
        setError(errorMessage(cause, "No pudimos sumar la cantidad."));
      } finally {
        setPending(false);
      }
      return;
    }

    const factorMicros = toMicros(factorText);
    const minMicros = minText.trim() ? toMicros(minText) : 0;
    if (!presentation.trim()) return setError("Escribe la presentación de compra, por ejemplo Bulto de 5 kg.");
    if (!(factorMicros > 0)) return setError("La equivalencia debe ser mayor a cero.");
    if (Number.isNaN(minMicros) || minMicros < 0) {
      return setError("El mínimo de alerta debe ser cero o mayor.");
    }

    setPending(true);
    try {
      await onSave({
        name: name.trim(),
        unit,
        category,
        minMicros,
        presentation: presentation.trim(),
        factorMicros,
        ...(item ? {} : { initialMicros }),
      });
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos guardar el insumo."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={item ? `Editar ${item.name}` : "Nuevo insumo"}
      wide
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="supply-form" className="site-button" disabled={pending}>
            {pending
              ? "Guardando…"
              : matchedExisting
                ? `Sumar a ${matchedExisting.name}`
                : "Guardar"}
          </Button>
        </>
      }
    >
      <form id="supply-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-form-grid">
          <div className="az-field full">
            <label htmlFor="sup-name">Nombre</label>
            <input
              id="sup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Salmón, Carne de res…"
              required
              autoFocus
            />
          </div>

          {matchedExisting ? (
            <>
              <div className="az-notice full">
                <Info className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  <strong>{matchedExisting.name}</strong> ya está en tu inventario con{" "}
                  <strong>{formatQty(matchedExisting.stockMicros, matchedExisting.unit)}</strong>
                  {!matchedExisting.isActive ? " (archivado y se restaurará)" : ""}. Al guardar, la cantidad se sumará
                  directamente a su existencia actual.
                </span>
              </div>
              <div className="az-field full">
                <label htmlFor="sup-initial">
                  Cantidad a sumar ({UNIT_SHORT[matchedExisting.unit]})
                </label>
                <input
                  id="sup-initial"
                  inputMode="decimal"
                  value={initialText}
                  onChange={(e) => setInitialText(e.target.value)}
                  placeholder="1000"
                  required
                />
              </div>
            </>
          ) : (
            <>
              <div className="az-field">
                <label htmlFor="sup-cat">Categoría</label>
                <select id="sup-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="az-field">
                <label htmlFor="sup-unit">Unidad base</label>
                <select id="sup-unit" value={effectiveUnit} onChange={(e) => setUnit(e.target.value as InventoryUnit)}>
                  {(Object.entries(UNIT_LABELS) as Array<[InventoryUnit, string]>).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="az-field">
                <label htmlFor="sup-pres">Presentación de compra</label>
                <input
                  id="sup-pres"
                  value={presentation}
                  onChange={(e) => setPresentation(e.target.value)}
                  placeholder="Caja de 5 kg, Paquete de 12…"
                  required
                />
              </div>
              <div className="az-field">
                <label htmlFor="sup-factor">Equivale a ({UNIT_SHORT[effectiveUnit]})</label>
                <input
                  id="sup-factor"
                  inputMode="decimal"
                  value={factorText}
                  onChange={(e) => setFactorText(e.target.value)}
                  placeholder="5000"
                  required
                />
              </div>
              <div className="az-field">
                <label htmlFor="sup-min">Mínimo para alerta ({UNIT_SHORT[effectiveUnit]}, opcional)</label>
                <input
                  id="sup-min"
                  inputMode="decimal"
                  value={minText}
                  onChange={(e) => setMinText(e.target.value)}
                  placeholder="0"
                />
              </div>
              {!item && (
                <div className="az-field">
                  <label htmlFor="sup-initial">Existencia inicial ({UNIT_SHORT[effectiveUnit]})</label>
                  <input
                    id="sup-initial"
                    inputMode="decimal"
                    value={initialText}
                    onChange={(e) => setInitialText(e.target.value)}
                    placeholder="0"
                  />
                </div>
              )}
            </>
          )}
        </div>
        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}

function EntryModal({
  items,
  currencyCode,
  initialItemId,
  presetUnits,
  onClose,
  onSave,
}: {
  items: Item[];
  currencyCode: string;
  initialItemId?: Id<"inventoryItems">;
  presetUnits?: number;
  onClose: () => void;
  onSave: (payload: {
    inventoryItemId: Id<"inventoryItems">;
    addedMicros: number;
    costCents?: number;
    note?: string;
  }) => Promise<void>;
}) {
  const initialItem = items.find((i) => i._id === initialItemId) ?? items[0];
  const [itemId, setItemId] = useState<string>(initialItem?._id ?? "");
  const [mode, setMode] = useState<"pres" | "base">("pres");
  const [qtyText, setQtyText] = useState(presetUnits ? String(presetUnits) : "");
  const [costText, setCostText] = useState(initialItem?.lastCostCents ? centsToInput(initialItem.lastCostCents) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selected = items.find((i) => i._id === itemId);
  const qtyNum = Number(qtyText.replace(/,/g, "").trim());
  const addedMicros =
    selected && Number.isFinite(qtyNum) && qtyNum > 0
      ? Math.round(qtyNum * (mode === "base" ? MICROS_PER_UNIT : selected.factorMicros))
      : 0;

  function onItemChange(nextId: string) {
    setItemId(nextId);
    const next = items.find((i) => i._id === nextId);
    if (next) {
      setCostText(next.lastCostCents ? centsToInput(next.lastCostCents) : "");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selected) return setError("Elige un insumo.");
    if (!(addedMicros > 0) || !Number.isSafeInteger(addedMicros)) {
      return setError("Escribe una cantidad mayor a cero.");
    }
    const costCents = costText.trim() ? parseMoneyCents(costText) : undefined;
    if (costText.trim() && (costCents === undefined || Number.isNaN(costCents))) {
      return setError("Escribe un costo válido, por ejemplo 1250.00.");
    }
    const unitText = mode === "base" ? UNIT_SHORT[selected.unit] : selected.presentation;
    const note = `${qtyText.trim()} × ${unitText}`;

    setPending(true);
    try {
      await onSave({
        inventoryItemId: selected._id,
        addedMicros,
        costCents,
        note,
      });
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos registrar la entrada."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title="Registrar entrada de mercancía"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="entry-form" className="site-button" disabled={pending}>
            {pending ? "Registrando…" : "Registrar entrada"}
          </Button>
        </>
      }
    >
      <form id="entry-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-form-grid">
          <div className="az-field full">
            <label htmlFor="ent-item">Insumo</label>
            <select id="ent-item" value={itemId} onChange={(e) => onItemChange(e.target.value)}>
              {items.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="az-field">
            <label htmlFor="ent-mode">Presentación</label>
            <select id="ent-mode" value={mode} onChange={(e) => setMode(e.target.value as "pres" | "base")}>
              <option value="pres">
                {selected
                  ? `${selected.presentation} (${formatQty(selected.factorMicros, selected.unit)})`
                  : "Presentación"}
              </option>
              <option value="base">
                {selected ? `Suelto, en ${UNIT_SHORT[selected.unit]}` : "Suelto"}
              </option>
            </select>
          </div>
          <div className="az-field">
            <label htmlFor="ent-qty">Cantidad</label>
            <input
              id="ent-qty"
              inputMode="decimal"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              placeholder="1"
              required
              autoFocus
            />
          </div>
          <div className="az-field full">
            <label htmlFor="ent-cost">Costo ({currencyCode}, opcional)</label>
            <input
              id="ent-cost"
              inputMode="decimal"
              value={costText}
              onChange={(e) => setCostText(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>
        {selected && (
          <div className="az-totals">
            <div>
              <span>Existencia actual</span>
              <span>{formatQty(selected.stockMicros, selected.unit)}</span>
            </div>
            <div>
              <span>Suma</span>
              <span>+{formatQty(addedMicros, selected.unit)}</span>
            </div>
            <div className="grand">
              <span>Quedará en</span>
              <span>{formatQty(selected.stockMicros + addedMicros, selected.unit)}</span>
            </div>
          </div>
        )}
        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}

function AdjustModal({
  item,
  onClose,
  onSave,
}: {
  item: Item;
  onClose: () => void;
  onSave: (payload: { deltaMicros: number; kind: "adjustment" | "waste"; reason: string }) => Promise<void>;
}) {
  const [kind, setKind] = useState<"adjustment" | "waste">("adjustment");
  const [deltaText, setDeltaText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let deltaMicros = toMicros(deltaText);
    if (Number.isNaN(deltaMicros) || deltaMicros === 0) {
      return setError("Escribe una diferencia distinta de cero, por ejemplo -250.");
    }
    if (kind === "waste" && deltaMicros > 0) {
      deltaMicros = -deltaMicros;
    }
    if (!reason.trim()) return setError("Escribe el motivo del ajuste.");

    setPending(true);
    try {
      await onSave({ deltaMicros, kind, reason: reason.trim() });
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos registrar el ajuste."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={`Ajustar ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="adjust-form" className="site-button" disabled={pending}>
            {pending ? "Guardando…" : "Registrar ajuste"}
          </Button>
        </>
      }
    >
      <form id="adjust-form" className="grid gap-4" onSubmit={submit}>
        <p className="text-sm text-muted-foreground">
          Existencia actual: <strong>{formatQty(item.stockMicros, item.unit)}</strong>. El ajuste crea un movimiento
          y conserva el historial completo.
        </p>
        <div className="az-field">
          <label htmlFor="adj-kind">Tipo de movimiento</label>
          <select id="adj-kind" value={kind} onChange={(e) => setKind(e.target.value as "adjustment" | "waste")}>
            <option value="adjustment">Ajuste de conteo (positivo o negativo)</option>
            <option value="waste">Merma (siempre resta existencias)</option>
          </select>
        </div>
        <div className="az-field">
          <label htmlFor="adj-qty">
            {kind === "waste"
              ? `Cantidad perdida en ${UNIT_SHORT[item.unit]}`
              : `Diferencia en ${UNIT_SHORT[item.unit]} (usa signo menos para restar)`}
          </label>
          <input
            id="adj-qty"
            inputMode="decimal"
            value={deltaText}
            onChange={(e) => setDeltaText(e.target.value)}
            placeholder={kind === "waste" ? "250" : "-250"}
            required
            autoFocus
          />
        </div>
        <div className="az-field">
          <label htmlFor="adj-reason">Motivo</label>
          <input
            id="adj-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Conteo físico, producto caducado…"
            required
          />
        </div>
        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}
