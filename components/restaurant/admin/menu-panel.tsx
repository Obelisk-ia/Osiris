"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  Edit3,
  Eye,
  EyeOff,
  ImagePlus,
  Plus,
  Search,
  Trash2,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  centsToInput,
  errorMessage,
  formatMoney,
  formatQty,
  fromMicros,
  parseMoneyCents,
  toMicros,
  UNIT_SHORT,
} from "@/lib/format";
import { AdminModal, AdminPageHead, ConfirmModal, EmptyState, ToastBanner, useToast } from "./admin-ui";

type Snapshot = NonNullable<ReturnType<typeof usePreloadedQuery<typeof api.menu.snapshot>>>;
type Dish = Snapshot["dishes"][number];
type Category = Snapshot["categories"][number];
type ModifierGroup = Snapshot["modifierGroups"][number];
type InventoryPicker = Snapshot["inventoryItems"][number];
type PreparationArea = Snapshot["enabledAreas"][number];

type MenuTab = "productos" | "categorias" | "modificadores" | "areas";

const PREPARATION_AREAS: ReadonlyArray<{
  key: PreparationArea;
  label: string;
  description: string;
}> = [
  { key: "kitchen", label: "Cocina", description: "Platillos calientes, parrilla y preparación en cocina." },
  { key: "bar", label: "Barra", description: "Barra fría, sushi, cervezas y bebidas de barra." },
  { key: "cocktails", label: "Coctelería", description: "Cocteles, destilados y mixología." },
  { key: "coffee", label: "Cafetería", description: "Café, espresso, tés y bebidas de barista." },
];

const AREA_LABELS: Record<PreparationArea, string> = {
  kitchen: "Cocina",
  bar: "Barra",
  cocktails: "Coctelería",
  coffee: "Cafetería",
};

export function MenuPanel({ preloaded }: { preloaded: Preloaded<typeof api.menu.snapshot> }) {
  const data = usePreloadedQuery(preloaded);
  const { toast, showToast } = useToast();

  const generateUploadUrl = useMutation(api.menu.generateUploadUrl);
  const createDish = useMutation(api.menu.createDish);
  const updateDish = useMutation(api.menu.updateDish);
  const toggleDishAvailable = useMutation(api.menu.toggleDishAvailable);
  const removeDish = useMutation(api.menu.removeDish);
  const createCategory = useMutation(api.menu.createCategory);
  const updateCategory = useMutation(api.menu.updateCategory);
  const moveCategory = useMutation(api.menu.moveCategory);
  const toggleCategoryActive = useMutation(api.menu.toggleCategoryActive);
  const removeCategory = useMutation(api.menu.removeCategory);
  const createModifierGroup = useMutation(api.menu.createModifierGroup);
  const updateModifierGroup = useMutation(api.menu.updateModifierGroup);
  const removeModifierGroup = useMutation(api.menu.removeModifierGroup);
  const setPreparationAreaEnabled = useMutation(api.menu.setPreparationAreaEnabled);

  const [tab, setTab] = useState<MenuTab>("productos");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");

  const [dishModal, setDishModal] = useState<{ open: true; dish?: Dish } | null>(null);
  const [catModal, setCatModal] = useState<{ open: true; category?: Category } | null>(null);
  const [modModal, setModModal] = useState<{ open: true; group?: ModifierGroup } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "dish"; dish: Dish }
    | { kind: "category"; category: Category }
    | { kind: "modifier"; group: ModifierGroup }
    | null
  >(null);
  const [deletePending, setDeletePending] = useState(false);

  const q = search.trim().toLowerCase();
  const orderedDishes = [...data.dishes].sort((a, b) => {
    const ai = a.categoryId ? data.categories.findIndex((c) => c._id === a.categoryId) : 999;
    const bi = b.categoryId ? data.categories.findIndex((c) => c._id === b.categoryId) : 999;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name, "es-MX");
  });

  const filteredDishes = orderedDishes.filter((dish) => {
    if (catFilter === "uncategorized" && dish.categoryId !== null) return false;
    if (catFilter !== "all" && catFilter !== "uncategorized" && dish.categoryId !== catFilter) return false;
    if (q && !dish.name.toLowerCase().includes(q) && !dish.description.toLowerCase().includes(q)) return false;
    return true;
  });

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      if (deleteTarget.kind === "dish") {
        await removeDish({ dishId: deleteTarget.dish._id });
        showToast("Platillo eliminado");
      } else if (deleteTarget.kind === "category") {
        await removeCategory({ categoryId: deleteTarget.category._id });
        showToast("Categoría eliminada");
      } else {
        await removeModifierGroup({ groupId: deleteTarget.group._id });
        showToast("Grupo de modificadores eliminado");
      }
      setDeleteTarget(null);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos eliminarlo."), "err");
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="az-page">
      <AdminPageHead
        index={3}
        total={8}
        restaurantName={data.restaurantName}
        locationName={data.locationName}
        title="Menú"
        subtitle="Define cada platillo con su título, descripción, foto opcional y las cantidades exactas de ingredientes que consume."
      />

      <div className="az-tabs" role="tablist" aria-label="Secciones del menú">
        <button type="button" className="az-tab" role="tab" aria-selected={tab === "productos"} onClick={() => setTab("productos")}>
          Productos
          {data.dishes.length > 0 && <span className="az-count">{data.dishes.length}</span>}
        </button>
        <button type="button" className="az-tab" role="tab" aria-selected={tab === "categorias"} onClick={() => setTab("categorias")}>
          Categorías
        </button>
        <button type="button" className="az-tab" role="tab" aria-selected={tab === "modificadores"} onClick={() => setTab("modificadores")}>
          Modificadores
        </button>
        <button type="button" className="az-tab" role="tab" aria-selected={tab === "areas"} onClick={() => setTab("areas")}>
          Áreas
          <span className="az-count">{data.enabledAreas.length}</span>
        </button>
      </div>

      {tab === "productos" && (
        <div className="grid gap-4">
          <div className="az-toolbar">
            <div className="az-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                placeholder="Buscar platillo o descripción"
                aria-label="Buscar platillo"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="Filtrar por categoría"
              className="az-select"
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
            >
              <option value="all">Todas las categorías</option>
              {data.categories.map((cat) => (
                <option key={cat._id} value={cat._id}>
                  {cat.name}
                </option>
              ))}
              <option value="uncategorized">Sin categoría</option>
            </select>
            <Button className="site-button" onClick={() => setDishModal({ open: true })}>
              <Plus className="size-4" aria-hidden="true" />
              Nuevo producto
            </Button>
          </div>

          {filteredDishes.length > 0 ? (
            <ul className="az-rows">
              {filteredDishes.map((dish) => (
                <li key={dish._id}>
                  <div className="az-row-main">
                    <div className="az-thumb">
                      {dish.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={dish.photoUrl} alt={dish.name} />
                      ) : (
                        <Utensils className="size-5" aria-hidden="true" />
                      )}
                    </div>
                    <div className="az-row-text">
                      <strong className="text-[15px]">{dish.name}</strong>
                      {dish.description && (
                        <p className="text-sm text-[#2a2620] line-clamp-2">{dish.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {dish.categoryName ?? "Sin categoría"} ·{" "}
                        {dish.areas.map((a) => AREA_LABELS[a]).join(", ")}
                      </p>
                      <div className="az-cluster mt-1">
                        {!dish.isPublished && (
                          <span className="az-badge">
                            <EyeOff aria-hidden="true" />
                            Oculto
                          </span>
                        )}
                        {(!dish.isAvailable || dish.soldByIngredient) && (
                          <span className="az-badge danger">
                            <Ban aria-hidden="true" />
                            {dish.soldByIngredient ? "Agotado por insumo" : "Agotado"}
                          </span>
                        )}
                        {dish.recipe.length === 0 ? (
                          <span className="az-badge warn">
                            <AlertTriangle aria-hidden="true" />
                            Sin receta
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Receta:{" "}
                            {dish.recipe
                              .map((r) => `${r.itemName} ${formatQty(r.quantityMicros, r.unit)}`)
                              .join(" · ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="az-money text-base">
                      {formatMoney(dish.priceCents, data.currencyCode)}
                    </div>
                    <div className="az-row-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={dish.soldByIngredient}
                        onClick={async () => {
                          try {
                            await toggleDishAvailable({ dishId: dish._id });
                            showToast(dish.isAvailable ? "Marcado como agotado" : "Disponible de nuevo");
                          } catch (cause) {
                            showToast(errorMessage(cause), "err");
                          }
                        }}
                      >
                        {dish.isAvailable ? "Agotado" : "Disponible"}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Editar ${dish.name}`}
                        onClick={() => setDishModal({ open: true, dish })}
                      >
                        <Edit3 aria-hidden="true" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Borrar ${dish.name}`}
                        onClick={() => setDeleteTarget({ kind: "dish", dish })}
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
              icon={<Utensils className="size-7" aria-hidden="true" />}
              title={data.dishes.length === 0 ? "Tu menú está vacío" : "Sin productos"}
              description={
                data.dishes.length === 0
                  ? "Agrega tu primer platillo con título, descripción, foto opcional y los ingredientes exactos que requiere."
                  : "Ningún platillo coincide con el filtro actual."
              }
              action={
                data.dishes.length === 0 ? (
                  <Button className="site-button mt-2" onClick={() => setDishModal({ open: true })}>
                    <Plus className="size-4" aria-hidden="true" />
                    Agregar primer platillo
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      )}

      {tab === "categorias" && (
        <div className="grid gap-4">
          <div className="az-toolbar">
            <Button className="site-button" onClick={() => setCatModal({ open: true })}>
              <Plus className="size-4" aria-hidden="true" />
              Nueva categoría
            </Button>
          </div>
          {data.categories.length > 0 ? (
            <ul className="az-rows">
              {data.categories.map((cat, idx) => {
                const count = data.dishes.filter((d) => d.categoryId === cat._id).length;
                return (
                  <li key={cat._id}>
                    <div className="az-row-main">
                      <div className="az-row-text">
                        <strong>{cat.name}</strong>
                        <p className="text-xs text-muted-foreground">
                          {count} {count === 1 ? "producto" : "productos"}
                          {!cat.isActive ? " · Oculta" : ""}
                        </p>
                      </div>
                      <div className="az-row-actions">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          disabled={idx === 0}
                          aria-label={`Subir ${cat.name}`}
                          onClick={() => void moveCategory({ categoryId: cat._id, direction: "up" })}
                        >
                          <ArrowUp aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          disabled={idx === data.categories.length - 1}
                          aria-label={`Bajar ${cat.name}`}
                          onClick={() => void moveCategory({ categoryId: cat._id, direction: "down" })}
                        >
                          <ArrowDown aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`${cat.isActive ? "Ocultar" : "Mostrar"} ${cat.name}`}
                          onClick={async () => {
                            try {
                              await toggleCategoryActive({ categoryId: cat._id });
                              showToast(cat.isActive ? `${cat.name} oculta del menú` : `${cat.name} visible de nuevo`);
                            } catch (cause) {
                              showToast(errorMessage(cause), "err");
                            }
                          }}
                        >
                          {cat.isActive ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Renombrar ${cat.name}`}
                          onClick={() => setCatModal({ open: true, category: cat })}
                        >
                          <Edit3 aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Borrar ${cat.name}`}
                          onClick={() => setDeleteTarget({ kind: "category", category: cat })}
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
              icon={<Utensils className="size-7" aria-hidden="true" />}
              title="Sin categorías"
              description="Crea categorías como Entradas, Platos fuertes, Postres y Bebidas para ordenar tu carta."
            />
          )}
        </div>
      )}

      {tab === "modificadores" && (
        <div className="grid gap-4">
          <div className="az-toolbar">
            <Button className="site-button" onClick={() => setModModal({ open: true })}>
              <Plus className="size-4" aria-hidden="true" />
              Nuevo grupo
            </Button>
          </div>
          {data.modifierGroups.length > 0 ? (
            <ul className="az-rows">
              {data.modifierGroups.map((group) => {
                const required = group.minSelections > 0;
                const multi = group.maxSelections === null || group.maxSelections > 1;
                return (
                  <li key={group._id}>
                    <div className="az-row-main">
                      <div className="az-row-text">
                        <strong>{group.name}</strong>
                        <p className="text-xs text-muted-foreground">
                          {required ? "Obligatorio" : "Opcional"} · {multi ? "Selección múltiple" : "Selección única"}
                        </p>
                        <p className="text-sm text-[#2a2620] mt-1">
                          {group.options
                            .map(
                              (opt) =>
                                `${opt.name}${opt.priceExtraCents > 0 ? ` +${formatMoney(opt.priceExtraCents, data.currencyCode)}` : ""}${opt.inventoryItemName && opt.inventoryUnit ? ` (${formatQty(opt.quantityDeltaMicros, opt.inventoryUnit)} ${opt.inventoryItemName})` : ""}`,
                            )
                            .join(", ")}
                        </p>
                      </div>
                      <div className="az-row-actions">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Editar ${group.name}`}
                          onClick={() => setModModal({ open: true, group })}
                        >
                          <Edit3 aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Borrar ${group.name}`}
                          onClick={() => setDeleteTarget({ kind: "modifier", group })}
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
              icon={<Utensils className="size-7" aria-hidden="true" />}
              title="Sin grupos de modificadores"
              description="Crea grupos como Término de la carne, Salsa o Extras con precio adicional y consumo de insumos."
            />
          )}
        </div>
      )}

      {tab === "areas" && (
        <div className="grid gap-4 max-w-[780px]">
          <p className="text-sm text-muted-foreground">
            Activa solo las estaciones que utiliza tu restaurante. Al crear o editar un platillo podrás asignarlo a una o
            varias áreas a la vez (por ejemplo, Cocina y Barra).
          </p>
          <ul className="az-rows">
            {PREPARATION_AREAS.map((area) => {
              const enabled = data.enabledAreas.includes(area.key);
              const dishCount = data.dishes.filter((d) => d.areas.includes(area.key)).length;
              return (
                <li key={area.key}>
                  <div className="az-row-main">
                    <div className="az-row-text">
                      <div className="az-cluster">
                        <strong>{area.label}</strong>
                        <span className="az-badge">
                          {dishCount} {dishCount === 1 ? "platillo" : "platillos"}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{area.description}</p>
                    </div>
                    <label className="az-check shrink-0">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={async (e) => {
                          try {
                            await setPreparationAreaEnabled({ area: area.key, enabled: e.target.checked });
                            showToast(`${area.label}: ${e.target.checked ? "activa" : "desactivada"}`);
                          } catch (cause) {
                            showToast(errorMessage(cause, "No pudimos actualizar el área."), "err");
                          }
                        }}
                      />
                      <span>{enabled ? "Activa" : "Apagada"}</span>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {dishModal && (
        <DishModal
          dish={dishModal.dish}
          categories={data.categories}
          modifierGroups={data.modifierGroups}
          inventoryItems={data.inventoryItems}
          enabledAreas={data.enabledAreas}
          currencyCode={data.currencyCode}
          generateUploadUrl={generateUploadUrl}
          onClose={() => setDishModal(null)}
          onSave={async (payload) => {
            if (dishModal.dish) {
              await updateDish({ dishId: dishModal.dish._id, ...payload });
              showToast("Platillo actualizado");
            } else {
              await createDish({
                name: payload.name,
                description: payload.description,
                priceCents: payload.priceCents,
                categoryId: payload.categoryId,
                areas: payload.areas,
                isPublished: payload.isPublished,
                isAvailable: payload.isAvailable,
                photoId: payload.photoId,
                modifierGroupIds: payload.modifierGroupIds,
                recipe: payload.recipe,
              });
              showToast("Platillo creado");
            }
            setDishModal(null);
          }}
        />
      )}

      {catModal && (
        <CategoryModal
          category={catModal.category}
          onClose={() => setCatModal(null)}
          onSave={async (name) => {
            if (catModal.category) {
              await updateCategory({ categoryId: catModal.category._id, name });
              showToast("Categoría actualizada");
            } else {
              await createCategory({ name });
              showToast("Categoría creada");
            }
            setCatModal(null);
          }}
        />
      )}

      {modModal && (
        <ModifierGroupModal
          group={modModal.group}
          inventoryItems={data.inventoryItems}
          onClose={() => setModModal(null)}
          onSave={async (payload) => {
            if (modModal.group) {
              await updateModifierGroup({ groupId: modModal.group._id, ...payload });
              showToast("Grupo actualizado");
            } else {
              await createModifierGroup(payload);
              showToast("Grupo creado");
            }
            setModModal(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={
            deleteTarget.kind === "dish"
              ? `Borrar ${deleteTarget.dish.name}`
              : deleteTarget.kind === "category"
                ? `Borrar ${deleteTarget.category.name}`
                : `Borrar ${deleteTarget.group.name}`
          }
          message={
            deleteTarget.kind === "dish"
              ? "Dejará de mostrarse en el menú. Esta acción no afecta registros cerrados."
              : deleteTarget.kind === "category"
                ? "Solo se pueden borrar categorías sin productos asignados."
                : "Se quitará de todos los platillos que lo utilizan."
          }
          confirmLabel="Borrar"
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

function DishModal({
  dish,
  categories,
  modifierGroups,
  inventoryItems,
  enabledAreas,
  currencyCode,
  generateUploadUrl,
  onClose,
  onSave,
}: {
  dish?: Dish;
  categories: Category[];
  modifierGroups: ModifierGroup[];
  inventoryItems: InventoryPicker[];
  enabledAreas: PreparationArea[];
  currencyCode: string;
  generateUploadUrl: () => Promise<string>;
  onClose: () => void;
  onSave: (payload: {
    name: string;
    description?: string;
    priceCents: number;
    categoryId?: Id<"dishCategories">;
    areas: PreparationArea[];
    isPublished: boolean;
    isAvailable: boolean;
    photoId?: Id<"_storage">;
    removePhoto?: boolean;
    modifierGroupIds: Id<"modifierGroups">[];
    recipe: Array<{ inventoryItemId: Id<"inventoryItems">; quantityMicros: number }>;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(dish?.name ?? "");
  const [description, setDescription] = useState(dish?.description ?? "");
  const [priceText, setPriceText] = useState(dish ? centsToInput(dish.priceCents) : "");
  const [categoryId, setCategoryId] = useState<string>(dish?.categoryId ?? categories[0]?._id ?? "");
  const [selectedAreas, setSelectedAreas] = useState<PreparationArea[]>(() =>
    dish?.areas.length ? [...dish.areas] : [enabledAreas[0] ?? "kitchen"],
  );
  const [isPublished, setIsPublished] = useState(dish?.isPublished ?? true);
  const [isAvailable, setIsAvailable] = useState(dish?.isAvailable ?? true);
  const [selectedMods, setSelectedMods] = useState<Set<Id<"modifierGroups">>>(
    () => new Set(dish?.modifierGroupIds ?? []),
  );
  const [recipeRows, setRecipeRows] = useState<Array<{ inventoryItemId: string; qtyText: string }>>(() =>
    dish
      ? dish.recipe.map((r) => ({
          inventoryItemId: r.inventoryItemId,
          qtyText: String(fromMicros(r.quantityMicros)),
        }))
      : [],
  );

  const visibleAreas = PREPARATION_AREAS.filter(
    (entry) => enabledAreas.includes(entry.key) || selectedAreas.includes(entry.key),
  );

  function toggleArea(area: PreparationArea) {
    setSelectedAreas((prev) =>
      prev.includes(area) ? prev.filter((item) => item !== area) : [...prev, area],
    );
  }

  // Optional photo state (existing URL or newly chosen local File).
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(dish?.photoUrl ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Selecciona un archivo de imagen (JPG, PNG o WebP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("La foto debe pesar menos de 5 MB.");
      return;
    }
    setError(null);
    setPhotoFile(file);
    setRemovePhoto(false);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  }

  function addRecipeRow() {
    const used = new Set(recipeRows.map((r) => r.inventoryItemId));
    const candidate = inventoryItems.find((item) => !used.has(item._id)) ?? inventoryItems[0];
    if (!candidate) return;
    setRecipeRows((prev) => [...prev, { inventoryItemId: candidate._id, qtyText: "" }]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Escribe el título del platillo.");
    const priceCents = parseMoneyCents(priceText);
    if (!(priceCents > 0)) return setError("Escribe un precio mayor a cero, por ejemplo 125.00.");
    if (selectedAreas.length === 0) return setError("Elige al menos un área que lo prepara.");

    const parsedRecipe: Array<{ inventoryItemId: Id<"inventoryItems">; quantityMicros: number }> = [];
    for (const row of recipeRows) {
      if (!row.inventoryItemId) return setError("Elige un ingrediente en cada fila de la receta.");
      const micros = toMicros(row.qtyText);
      if (!(micros > 0)) return setError("Cada ingrediente debe tener una cantidad mayor a cero.");
      parsedRecipe.push({
        inventoryItemId: row.inventoryItemId as Id<"inventoryItems">,
        quantityMicros: micros,
      });
    }

    setPending(true);
    try {
      let uploadedPhotoId: Id<"_storage"> | undefined = undefined;
      if (photoFile) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": photoFile.type },
          body: photoFile,
        });
        if (!res.ok) throw new Error("No pudimos subir la foto.");
        const json = (await res.json()) as { storageId?: string };
        if (!json.storageId) throw new Error("Respuesta inesperada al subir la foto.");
        uploadedPhotoId = json.storageId as Id<"_storage">;
      }

      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        priceCents,
        categoryId: categoryId ? (categoryId as Id<"dishCategories">) : undefined,
        areas: selectedAreas,
        isPublished,
        isAvailable,
        photoId: uploadedPhotoId,
        removePhoto: removePhoto && !uploadedPhotoId ? true : undefined,
        modifierGroupIds: [...selectedMods],
        recipe: parsedRecipe,
      });
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos guardar el platillo."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={dish ? `Editar ${dish.name}` : "Nuevo producto"}
      wide
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="dish-form" className="site-button" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <form id="dish-form" className="grid gap-5" onSubmit={submit}>
        <div className="az-form-grid">
          <div className="az-field full">
            <label htmlFor="dish-name">Título del platillo</label>
            <input
              id="dish-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hamburguesa con tocino"
              maxLength={100}
              required
              autoFocus
            />
          </div>

          <div className="az-field full">
            <label htmlFor="dish-desc">Descripción</label>
            <textarea
              id="dish-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Carne jugosa, queso fundido y tocino crujiente."
              maxLength={300}
            />
          </div>

          <div className="az-field">
            <label htmlFor="dish-price">Precio ({currencyCode})</label>
            <input
              id="dish-price"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder="145.00"
              required
            />
          </div>

          <div className="az-field">
            <label htmlFor="dish-cat">Categoría</label>
            <select id="dish-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map((cat) => (
                <option key={cat._id} value={cat._id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div className="az-field full">
            <label>Áreas que lo preparan</label>
            <div className="az-chips" role="group" aria-label="Áreas que preparan este platillo">
              {visibleAreas.map((entry) => {
                const active = selectedAreas.includes(entry.key);
                const disabled = !enabledAreas.includes(entry.key);
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className="az-chip"
                    aria-pressed={active}
                    onClick={() => toggleArea(entry.key)}
                  >
                    {entry.label}
                    {disabled ? " (apagada)" : ""}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-muted-foreground">
              Puedes seleccionar una o varias áreas (por ejemplo, Cocina y Barra).
            </span>
          </div>
        </div>

        <div className="az-field">
          <label htmlFor="dish-photo">Foto del platillo (opcional)</label>
          <div className="az-photo-preview">
            {photoPreviewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoPreviewUrl} alt="Vista previa del platillo" />
            )}
            <div className="grid gap-2">
              <label
                htmlFor="dish-photo"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold cursor-pointer hover:border-foreground w-fit"
              >
                <ImagePlus className="size-4" aria-hidden="true" />
                {photoPreviewUrl ? "Cambiar foto" : "Subir foto"}
              </label>
              <input
                id="dish-photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={handleFileChange}
              />
              {photoPreviewUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setPhotoFile(null);
                    setPhotoPreviewUrl(null);
                    setRemovePhoto(true);
                  }}
                >
                  Quitar foto
                </Button>
              )}
              <span className="text-xs text-muted-foreground">JPG, PNG o WebP hasta 5 MB.</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-5">
          <label className="az-check">
            <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
            <span>Publicado en el menú</span>
          </label>
          <label className="az-check">
            <input type="checkbox" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} />
            <span>Disponible para pedir</span>
          </label>
        </div>

        {modifierGroups.length > 0 && (
          <fieldset className="grid gap-2 border-t border-[#ddd2b6] pt-4">
            <legend className="font-heading text-sm font-bold">Grupos de modificadores</legend>
            <div className="grid gap-1">
              {modifierGroups.map((group) => {
                const checked = selectedMods.has(group._id);
                return (
                  <label key={group._id} className="az-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedMods((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(group._id);
                          else next.delete(group._id);
                          return next;
                        });
                      }}
                    />
                    <span>
                      {group.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        · {group.minSelections > 0 ? "Obligatorio" : "Opcional"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <section className="grid gap-3 border-t border-[#ddd2b6] pt-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="font-heading text-sm font-bold">Receta (ingredientes y cantidad exacta)</h3>
              <p className="text-xs text-muted-foreground">
                Cada orden descontará exactamente estas cantidades del inventario.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={inventoryItems.length === 0}
              onClick={addRecipeRow}
            >
              <Plus className="size-4" aria-hidden="true" />
              Agregar ingrediente
            </Button>
          </div>

          {inventoryItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Todavía no hay insumos en el inventario.{" "}
              <Link href="/cuenta/administracion/inventario" className="underline">
                Crea tus insumos aquí
              </Link>{" "}
              para vincularlos a la receta.
            </p>
          ) : recipeRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sin receta el platillo se puede vender, pero no descontará insumos del inventario.
            </p>
          ) : (
            <div className="grid gap-3">
              {recipeRows.map((row, idx) => {
                const inv = inventoryItems.find((i) => i._id === row.inventoryItemId);
                return (
                  <div key={idx} className="az-repeat-row">
                    <div className="az-field">
                      <label htmlFor={`rec-item-${idx}`}>Ingrediente</label>
                      <select
                        id={`rec-item-${idx}`}
                        value={row.inventoryItemId}
                        onChange={(e) =>
                          setRecipeRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, inventoryItemId: e.target.value } : r)),
                          )
                        }
                      >
                        {inventoryItems.map((item) => (
                          <option key={item._id} value={item._id}>
                            {item.name} ({UNIT_SHORT[item.unit]})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="az-field">
                      <label htmlFor={`rec-qty-${idx}`}>Cantidad ({inv ? UNIT_SHORT[inv.unit] : ""})</label>
                      <input
                        id={`rec-qty-${idx}`}
                        inputMode="decimal"
                        value={row.qtyText}
                        onChange={(e) =>
                          setRecipeRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, qtyText: e.target.value } : r)),
                          )
                        }
                        placeholder="150"
                        required
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Quitar ingrediente"
                      onClick={() => setRecipeRows((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}

function CategoryModal({
  category,
  onClose,
  onSave,
}: {
  category?: Category;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Escribe el nombre de la categoría.");
    setPending(true);
    try {
      await onSave(name.trim());
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos guardar la categoría."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={category ? "Renombrar categoría" : "Nueva categoría"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="cat-form" className="site-button" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <form id="cat-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-field">
          <label htmlFor="cat-name">Nombre</label>
          <input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Entradas, Platos fuertes…" required autoFocus />
        </div>
        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}

type OptionDraft = { name: string; extraText: string; inventoryItemId: string; qtyText: string };

function ModifierGroupModal({
  group,
  inventoryItems,
  onClose,
  onSave,
}: {
  group?: ModifierGroup;
  inventoryItems: InventoryPicker[];
  onClose: () => void;
  onSave: (payload: {
    name: string;
    required: boolean;
    multi: boolean;
    options: Array<{
      name: string;
      priceExtraCents: number;
      inventoryItemId?: Id<"inventoryItems">;
      quantityDeltaMicros?: number;
    }>;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [required, setRequired] = useState(group ? group.minSelections > 0 : false);
  const [multi, setMulti] = useState(group ? group.maxSelections === null || group.maxSelections > 1 : false);
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    group && group.options.length > 0
      ? group.options.map((opt) => ({
          name: opt.name,
          extraText: opt.priceExtraCents ? centsToInput(opt.priceExtraCents) : "",
          inventoryItemId: opt.inventoryItemId ?? "",
          qtyText: opt.quantityDeltaMicros ? String(fromMicros(opt.quantityDeltaMicros)) : "",
        }))
      : [{ name: "", extraText: "", inventoryItemId: "", qtyText: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Escribe el nombre del grupo.");
    const parsedOptions: Array<{
      name: string;
      priceExtraCents: number;
      inventoryItemId?: Id<"inventoryItems">;
      quantityDeltaMicros?: number;
    }> = [];

    for (const opt of options) {
      if (!opt.name.trim()) return setError("Escribe el nombre de cada opción.");
      const extraCents = opt.extraText.trim() ? parseMoneyCents(opt.extraText) : 0;
      if (Number.isNaN(extraCents) || extraCents < 0) {
        return setError("Escribe un precio extra válido, por ejemplo 25.00.");
      }
      let quantityDeltaMicros: number | undefined;
      if (opt.inventoryItemId) {
        const micros = toMicros(opt.qtyText);
        if (!(micros > 0)) return setError(`Escribe cuánto consume "${opt.name.trim()}".`);
        quantityDeltaMicros = micros;
      }
      parsedOptions.push({
        name: opt.name.trim(),
        priceExtraCents: extraCents,
        inventoryItemId: opt.inventoryItemId ? (opt.inventoryItemId as Id<"inventoryItems">) : undefined,
        quantityDeltaMicros,
      });
    }

    setPending(true);
    try {
      await onSave({ name: name.trim(), required, multi, options: parsedOptions });
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos guardar el grupo."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={group ? `Editar ${group.name}` : "Nuevo grupo de modificadores"}
      wide
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="mod-form" className="site-button" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <form id="mod-form" className="grid gap-4" onSubmit={submit}>
        <div className="az-field">
          <label htmlFor="mod-name">Nombre del grupo</label>
          <input
            id="mod-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Término de la carne, Extras…"
            required
            autoFocus
          />
        </div>
        <div className="grid gap-1">
          <label className="az-check">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            <span>Obligatorio: impide pedir el producto sin elegir</span>
          </label>
          <label className="az-check">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            <span>Permite elegir varias opciones</span>
          </label>
        </div>

        <section className="grid gap-3 border-t border-[#ddd2b6] pt-4">
          <h3 className="font-heading text-sm font-bold">Opciones</h3>
          {options.map((opt, idx) => {
            const inv = inventoryItems.find((i) => i._id === opt.inventoryItemId);
            return (
              <div key={idx} className="grid gap-3 rounded-xl border border-[#ddd2b6] p-3">
                <div className="az-form-grid">
                  <div className="az-field">
                    <label htmlFor={`opt-name-${idx}`}>Opción</label>
                    <input
                      id={`opt-name-${idx}`}
                      value={opt.name}
                      onChange={(e) =>
                        setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, name: e.target.value } : o)))
                      }
                      placeholder="Extra queso"
                      required
                    />
                  </div>
                  <div className="az-field">
                    <label htmlFor={`opt-extra-${idx}`}>Precio extra</label>
                    <input
                      id={`opt-extra-${idx}`}
                      inputMode="decimal"
                      value={opt.extraText}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((o, i) => (i === idx ? { ...o, extraText: e.target.value } : o)),
                        )
                      }
                      placeholder="0.00"
                    />
                  </div>
                  <div className="az-field">
                    <label htmlFor={`opt-inv-${idx}`}>Consume insumo (opcional)</label>
                    <select
                      id={`opt-inv-${idx}`}
                      value={opt.inventoryItemId}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((o, i) => (i === idx ? { ...o, inventoryItemId: e.target.value } : o)),
                        )
                      }
                    >
                      <option value="">Sin insumo</option>
                      {inventoryItems.map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name} ({UNIT_SHORT[item.unit]})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="az-field">
                    <label htmlFor={`opt-qty-${idx}`}>
                      Cantidad que consume {inv ? `(${UNIT_SHORT[inv.unit]})` : ""}
                    </label>
                    <input
                      id={`opt-qty-${idx}`}
                      inputMode="decimal"
                      disabled={!opt.inventoryItemId}
                      value={opt.qtyText}
                      onChange={(e) =>
                        setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, qtyText: e.target.value } : o)))
                      }
                      placeholder="30"
                    />
                  </div>
                </div>
                {options.length > 1 && (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Quitar opción
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setOptions((prev) => [...prev, { name: "", extraText: "", inventoryItemId: "", qtyText: "" }])
              }
            >
              <Plus className="size-4" aria-hidden="true" />
              Agregar opción
            </Button>
          </div>
        </section>

        {error && <p className="floor-error" role="alert">{error}</p>}
      </form>
    </AdminModal>
  );
}
