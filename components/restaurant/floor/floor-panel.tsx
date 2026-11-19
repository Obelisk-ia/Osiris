"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { ChevronRight, Move, Plus, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { LinkButton } from "@/components/link-button";
import { AdminPageHead } from "@/components/restaurant/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/format";
import { SectionForm, TableForm, TableTypeForm } from "./floor-forms";
import { TableShape } from "./table-shape";

type Section = Doc<"sections"> & { assignedStaffId: Id<"staff"> | null; tableCount: number };
type Table = Doc<"diningTables"> & {
  status: "empty" | "occupied" | "attended" | "payment";
  typeName: string | null;
};
type TableType = Doc<"tableTypes">;
type Waiter = { id: Id<"staff">; name: string };

type Editor =
  | { kind: "section"; id?: Id<"sections"> }
  | { kind: "table"; id?: Id<"diningTables">; sectionId?: Id<"sections">; x?: number; y?: number }
  | { kind: "type"; id?: Id<"tableTypes"> }
  | { kind: "types" }
  | null;

type Canvas = { x: number; y: number; width: number; height: number };
type TableDrag = { id: Id<"diningTables">; x: number; y: number };
type SectionDrag = { id: Id<"sections">; canvas: Canvas };

const STATUS_META = {
  empty: { label: "Libre", className: "empty" },
  occupied: { label: "Ocupada", className: "occupied" },
  attended: { label: "Pedido listo", className: "attended" },
  payment: { label: "Quieren pagar", className: "payment" },
} as const;
type StatusKey = keyof typeof STATUS_META;
const FILTERS: Array<{ key: "all" | StatusKey; label: string }> = [
  { key: "all", label: "Todas" },
  { key: "empty", label: "Libres" },
  { key: "occupied", label: "Ocupadas" },
  { key: "attended", label: "Pedido listo" },
  { key: "payment", label: "Quieren pagar" },
];

const clamp = (value: number, min: number, max: number) =>
  Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;

export function FloorPanel({
  preloaded,
  embedded = false,
  locationName,
}: {
  preloaded: Preloaded<typeof api.floor.snapshot>;
  embedded?: boolean;
  locationName?: string;
}) {
  const view = usePreloadedQuery(preloaded);
  const router = useRouter();
  const sections = view.sections as Section[];
  const tables = view.tables as Table[];
  const types = view.tableTypes as TableType[];
  const waiters = view.waiters as Waiter[];

  const createSection = useMutation(api.floor.createSection);
  const updateSection = useMutation(api.floor.updateSection);
  const removeSection = useMutation(api.floor.removeSection);

  // Optimistic updates keep dropped tables and sections locked at their new
  // position immediately without snapping back while Convex confirms the write.
  const moveSection = useMutation(api.floor.moveSection).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.floor.snapshot, {});
    if (!current) return;
    const maxOrder = Math.max(0, ...current.sections.map((item) => item.sortOrder));
    const nextSections = current.sections
      .map((section) =>
        section._id === args.sectionId
          ? {
              ...section,
              canvas: {
                x: args.canvas.x,
                y: args.canvas.y,
                width: args.canvas.width,
                height: args.canvas.height,
                rotation: args.canvas.rotation ?? 0,
              },
              sortOrder: maxOrder + 1,
            }
          : section,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
    localStore.setQuery(api.floor.snapshot, {}, { ...current, sections: nextSections });
  });

  const setSectionLayer = useMutation(api.floor.setSectionLayer).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.floor.snapshot, {});
    if (!current) return;
    const orders = current.sections.map((item) => item.sortOrder);
    const nextOrder = args.layer === "front" ? Math.max(0, ...orders) + 1 : Math.min(0, ...orders) - 1;
    const nextSections = current.sections
      .map((section) => (section._id === args.sectionId ? { ...section, sortOrder: nextOrder } : section))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    localStore.setQuery(api.floor.snapshot, {}, { ...current, sections: nextSections });
  });

  const createTable = useMutation(api.floor.createTable);
  const updateTable = useMutation(api.floor.updateTable);

  const moveTable = useMutation(api.floor.moveTable).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.floor.snapshot, {});
    if (!current) return;
    const targetSection = current.sections.find((s) => s._id === args.sectionId);
    if (!targetSection) return;
    const nextTables = current.tables.map((table) =>
      table._id === args.tableId
        ? {
            ...table,
            sectionId: args.sectionId,
            canvas: {
              x: args.x,
              y: args.y,
              width: targetSection.canvas.width,
              height: targetSection.canvas.height,
              rotation: 0,
            },
          }
        : table,
    );
    const nextSections = current.sections.map((section) => ({
      ...section,
      tableCount: nextTables.filter((table) => table.sectionId === section._id).length,
    }));
    localStore.setQuery(api.floor.snapshot, {}, { ...current, sections: nextSections, tables: nextTables });
  });

  const removeTable = useMutation(api.floor.removeTable);

  const setTableStatus = useMutation(api.floor.setTableStatus).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.floor.snapshot, {});
    if (!current) return;
    localStore.setQuery(api.floor.snapshot, {}, {
      ...current,
      tables: current.tables.map((table) =>
        table._id === args.tableId ? { ...table, status: args.status } : table,
      ),
    });
  });

  const createType = useMutation(api.floor.createTableType);
  const updateType = useMutation(api.floor.updateTableType);
  const removeType = useMutation(api.floor.removeTableType);

  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<"all" | StatusKey>("all");
  const [editor, setEditor] = useState<Editor>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableDrag, setTableDrag] = useState<TableDrag | null>(null);
  const [sectionDrag, setSectionDrag] = useState<SectionDrag | null>(null);
  const floorRef = useRef<HTMLDivElement>(null);
  // A drag ends with a click event; ignore that click so moving a table does
  // not pop open its edit form.
  const suppressTableClick = useRef(false);
  const tableDragRef = useRef<{
    id: Id<"diningTables">;
    sectionId: Id<"sections">;
    x: number;
    y: number;
    currentX: number;
    currentY: number;
    startX: number;
    startY: number;
    unitX: number;
    unitY: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);
  const sectionDragRef = useRef<{
    id: Id<"sections">;
    mode: "move" | "resize";
    original: Canvas;
    currentCanvas: Canvas;
    startX: number;
    startY: number;
    unit: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);

  const counts = tables.reduce<Record<StatusKey, number>>(
    (acc, table) => {
      acc[table.status] += 1;
      return acc;
    },
    { empty: 0, occupied: 0, attended: 0, payment: 0 },
  );

  function act(run: () => Promise<unknown>): Promise<void> {
    setError(null);
    return run()
      .then(() => undefined)
      .catch((cause) => {
        setError(errorMessage(cause, "No pudimos guardar el cambio."));
      });
  }

  function floorUnits() {
    const bottoms = sections.map((section) => {
      const preview = sectionDrag?.id === section._id ? sectionDrag.canvas : section.canvas;
      return preview.y + preview.height;
    });
    return Math.max(32, Math.max(0, ...bottoms) + 12);
  }

  function tablesIn(sectionId: Id<"sections">) {
    return tables.filter((table) => table.sectionId === sectionId);
  }

  function nextSectionCanvas() {
    const bottom = Math.max(0, ...sections.map((section) => section.canvas.y + section.canvas.height));
    return { x: 1, y: bottom + 1, width: 48, height: 28 };
  }

  function freeSpot(sectionId?: Id<"sections">) {
    const inSection = sectionId ? tables.filter((table) => table.sectionId === sectionId) : [];
    for (const y of [26, 50, 74]) {
      for (const x of [20, 50, 80]) {
        if (!inSection.some((table) => Math.abs(table.canvas.x - x) < 16 && Math.abs(table.canvas.y - y) < 18)) {
          return { x, y };
        }
      }
    }
    return { x: 50, y: 50 };
  }

  function nextTableName() {
    const numbers = tables
      .map((table) => Number(/^Mesa (\d+)$/.exec(table.tableNumber)?.[1] ?? 0))
      .filter((n) => n > 0);
    return `Mesa ${numbers.length ? Math.max(...numbers) + 1 : 1}`;
  }

  function startTableDrag(event: PointerEvent<HTMLButtonElement>, table: Table) {
    if (!editing || event.button !== 0) return;
    const bodyEl = document.querySelector(`[data-section-body="${table.sectionId}"]`) as HTMLElement | null;
    if (!bodyEl) return;
    const rect = bodyEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    tableDragRef.current = {
      id: table._id,
      sectionId: table.sectionId,
      x: table.canvas.x,
      y: table.canvas.y,
      currentX: table.canvas.x,
      currentY: table.canvas.y,
      startX: event.clientX,
      startY: event.clientY,
      unitX: rect.width / 100,
      unitY: rect.height / 100,
      pointerId: event.pointerId,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTableDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = tableDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / drag.unitX;
    const dy = (event.clientY - drag.startY) / drag.unitY;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    const nextX = clamp(drag.x + dx, 8, 92);
    const nextY = clamp(drag.y + dy, 12, 88);
    drag.currentX = nextX;
    drag.currentY = nextY;
    setTableDrag({ id: drag.id, x: nextX, y: nextY });
  }

  function endTableDrag(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const drag = tableDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    tableDragRef.current = null;
    if (!drag.moved || !commit) {
      setTableDrag(null);
      return;
    }
    suppressTableClick.current = true;
    setTimeout(() => {
      suppressTableClick.current = false;
    }, 100);

    const originSectionEl = document.querySelector(`[data-section="${drag.sectionId}"]`) as HTMLElement | null;
    let targetSectionEl = originSectionEl;
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const candidate = element.closest?.("[data-section]") as HTMLElement | null;
      if (candidate && candidate !== originSectionEl) {
        targetSectionEl = candidate;
        break;
      }
    }

    const targetSectionId = (targetSectionEl?.dataset.section as Id<"sections"> | undefined) ?? drag.sectionId;
    let nextX = drag.currentX;
    let nextY = drag.currentY;
    if (targetSectionId !== drag.sectionId && targetSectionEl) {
      const targetBody =
        (targetSectionEl.querySelector("[data-section-body]") as HTMLElement | null) ?? targetSectionEl;
      const rect = targetBody.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        nextX = clamp(((event.clientX - rect.left) / rect.width) * 100, 8, 92);
        nextY = clamp(((event.clientY - rect.top) / rect.height) * 100, 12, 88);
      }
    }

    // Fire the optimistic mutation before clearing local drag preview so the
    // table never snaps back to its old coordinates while Convex syncs.
    void act(() => moveTable({ tableId: drag.id, sectionId: targetSectionId, x: nextX, y: nextY }));
    setTableDrag(null);
  }

  function startSectionDrag(event: PointerEvent<HTMLElement>, section: Section, mode: "move" | "resize") {
    if (!editing || event.button !== 0 || !floorRef.current) return;
    if (mode === "move" && (event.target as HTMLElement).closest(".floor-section-actions")) return;
    const rect = floorRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const original = {
      x: section.canvas.x,
      y: section.canvas.y,
      width: section.canvas.width,
      height: section.canvas.height,
    };
    sectionDragRef.current = {
      id: section._id,
      mode,
      original,
      currentCanvas: { ...original },
      startX: event.clientX,
      startY: event.clientY,
      unit: rect.width / 100,
      pointerId: event.pointerId,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSectionDrag(event: PointerEvent<HTMLElement>) {
    const drag = sectionDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / drag.unit;
    const dy = (event.clientY - drag.startY) / drag.unit;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    const { original } = drag;
    const nextCanvas: Canvas =
      drag.mode === "move"
        ? {
            ...original,
            x: clamp(original.x + dx, 0, 100 - original.width),
            y: Math.max(0, Math.round(original.y + dy)),
          }
        : {
            ...original,
            width: clamp(original.width + dx, 10, 100 - original.x),
            height: Math.max(8, Math.round(original.height + dy)),
          };
    drag.currentCanvas = nextCanvas;
    setSectionDrag({ id: drag.id, canvas: nextCanvas });
  }

  function endSectionDrag(event: PointerEvent<HTMLElement>, commit: boolean) {
    const drag = sectionDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sectionDragRef.current = null;
    if (!drag.moved || !commit) {
      setSectionDrag(null);
      return;
    }
    void act(() => moveSection({ sectionId: drag.id, canvas: drag.currentCanvas }));
    setSectionDrag(null);
  }

  function onTableKey(event: KeyboardEvent<HTMLButtonElement>, table: Table) {
    if (!editing || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const dx = event.key === "ArrowLeft" ? -2 : event.key === "ArrowRight" ? 2 : 0;
    const dy = event.key === "ArrowUp" ? -2 : event.key === "ArrowDown" ? 2 : 0;
    void act(() =>
      moveTable({
        tableId: table._id,
        sectionId: table.sectionId,
        x: clamp(table.canvas.x + dx, 8, 92),
        y: clamp(table.canvas.y + dy, 12, 88),
      }),
    );
  }

  function onSectionKey(event: KeyboardEvent<HTMLButtonElement>, section: Section, mode: "move" | "resize") {
    if (!editing || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const dx = event.key === "ArrowLeft" ? -2 : event.key === "ArrowRight" ? 2 : 0;
    const dy = event.key === "ArrowUp" ? -2 : event.key === "ArrowDown" ? 2 : 0;
    const original = section.canvas;
    const canvas =
      mode === "move"
        ? { ...original, x: clamp(original.x + dx, 0, 100 - original.width), y: Math.max(0, original.y + dy) }
        : { ...original, width: clamp(original.width + dx, 10, 100 - original.x), height: Math.max(8, original.height + dy) };
    void act(() => moveSection({ sectionId: section._id, canvas }));
  }

  const sectionEditor = editor?.kind === "section" ? sections.find((s) => s._id === editor.id) : undefined;
  const tableEditor = editor?.kind === "table" ? tables.find((t) => t._id === editor.id) : undefined;
  const typeEditor = editor?.kind === "type" ? types.find((t) => t._id === editor.id) : undefined;

  return (
    <div className={embedded ? "az-page" : "restaurant-panel floor-panel"}>
      {embedded && (
        <AdminPageHead
          index={1}
          total={8}
          restaurantName={view.restaurantName}
          locationName={locationName ?? "Sucursal principal"}
          title="Plano de mesas"
          subtitle="Organiza tus secciones, tipos de mesa y lugares. Al arrastrar, los cambios se guardan al instante."
        />
      )}
      <div className="floor-topline">
        {!embedded && <p className="restaurant-eyebrow">{view.restaurantName}</p>}
        <div className="floor-stats" aria-label="Estado de las mesas">
          {FILTERS.slice(1).map((option) => (
            <span key={option.key} className={`floor-stat ${STATUS_META[option.key as StatusKey].className}`}>
              <strong>{counts[option.key as StatusKey]}</strong> {option.label}
            </span>
          ))}
        </div>
      </div>
      <div className="floor-toolbar">
        <div className="floor-filters" role="group" aria-label="Filtrar mesas">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`floor-chip${filter === option.key ? " active" : ""}`}
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {view.canEdit && (
          <div className="floor-actions">
            <Button variant="outline" onClick={() => setEditor({ kind: "types" })}>
              <SlidersHorizontal aria-hidden="true" />
              Tipos de mesa
            </Button>
            {editing ? (
              <>
                <Button variant="outline" onClick={() => setEditor({ kind: "section" })}>
                  <Plus aria-hidden="true" />
                  Sección
                </Button>
                <Button
                  className="site-button"
                  onClick={() => {
                    setEditing(false);
                    setEditor(null);
                  }}
                >
                  Terminar
                </Button>
              </>
            ) : (
              <Button className="site-button" onClick={() => setEditing(true)}>
                Editar plano
              </Button>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="floor-error" role="alert">
          {error}
        </p>
      )}

      {editor && view.canEdit && (
        <section className="floor-editor" aria-label="Editor del plano">
          {editor.kind === "section" && (
            <SectionForm
              key={sectionEditor?._id ?? "new"}
              section={sectionEditor}
              waiters={waiters}
              defaultCanvas={nextSectionCanvas()}
              onLayer={
                sectionEditor
                  ? (layer) => act(() => setSectionLayer({ sectionId: sectionEditor._id, layer }))
                  : undefined
              }
              onCancel={() => setEditor(null)}
              onDelete={
                sectionEditor
                  ? () =>
                      void act(async () => {
                        await removeSection({ sectionId: sectionEditor._id });
                        setEditor(null);
                      })
                  : undefined
              }
              onSave={async (values) => {
                await act(async () => {
                  if (sectionEditor) await updateSection({ sectionId: sectionEditor._id, ...values });
                  else await createSection(values);
                  setEditor(null);
                });
              }}
            />
          )}
          {editor.kind === "table" && (
            <TableForm
              key={tableEditor?._id ?? "new"}
              table={tableEditor}
              sections={sections}
              types={types}
              defaultName={nextTableName()}
              defaultSectionId={editor.sectionId}
              defaultPosition={
                editor.x !== undefined && editor.y !== undefined
                  ? { x: editor.x, y: editor.y }
                  : tableEditor
                    ? undefined
                    : freeSpot(editor.sectionId)
              }
              status={tableEditor?.status}
              onStatusChange={
                tableEditor
                  ? (status) => act(() => setTableStatus({ tableId: tableEditor._id, status }))
                  : undefined
              }
              onCancel={() => setEditor(null)}
              onDelete={
                tableEditor
                  ? () =>
                      void act(async () => {
                        await removeTable({ tableId: tableEditor._id });
                        setEditor(null);
                      })
                  : undefined
              }
              onSave={async (values) => {
                await act(async () => {
                  if (tableEditor) await updateTable({ tableId: tableEditor._id, ...values });
                  else await createTable(values);
                  setEditor(null);
                });
              }}
            />
          )}
          {editor.kind === "type" && (
            <TableTypeForm
              key={typeEditor?._id ?? "new"}
              type={typeEditor}
              onCancel={() => setEditor({ kind: "types" })}
              onDelete={
                typeEditor
                  ? () =>
                      void act(async () => {
                        await removeType({ tableTypeId: typeEditor._id });
                        setEditor({ kind: "types" });
                      })
                  : undefined
              }
              onSave={async ({ name, shape, seatCount, isActive }) => {
                await act(async () => {
                  if (typeEditor) await updateType({ tableTypeId: typeEditor._id, name, shape, seatCount, isActive });
                  else await createType({ name, shape, seatCount, isActive });
                  setEditor({ kind: "types" });
                });
              }}
            />
          )}
          {editor.kind === "types" && (
            <div className="floor-form">
              <h3>Tipos de mesa</h3>
              <ul className="floor-type-list">
                {types.map((type) => (
                  <li key={type._id}>
                    <span>
                      <strong>{type.name}</strong>
                      <small>
                        {type.seatCount} pers. · {type.shape}
                      </small>
                    </span>
                    <Button variant="outline" onClick={() => setEditor({ kind: "type", id: type._id })}>
                      Editar
                    </Button>
                  </li>
                ))}
              </ul>
              <FormActions
                onCancel={() => setEditor(null)}
                saveLabel="Nuevo tipo"
                onSaveNew={() => setEditor({ kind: "type" })}
              />
              <p className="small-note">
                Un tipo define forma, sillas y tamaño. Al crear una mesa puedes elegirlo o dejarla personalizada.
              </p>
            </div>
          )}
        </section>
      )}

      {sections.length === 0 ? (
        <div className="floor-empty">
          <p>Tu plano está vacío.</p>
          {view.canEdit && (
            <Button
              className="site-button"
              onClick={() => {
                setEditing(true);
                setEditor({ kind: "section" });
              }}
            >
              Agregar la primera sección
            </Button>
          )}
        </div>
      ) : (
        <div className="floor-scroll">
          <div
            ref={floorRef}
            className={`floor${editing ? " editing" : ""}`}
            style={{ aspectRatio: `100 / ${Math.round(floorUnits())}` }}
          >
            {sections.map((section, index) => {
              const preview = sectionDrag?.id === section._id ? sectionDrag.canvas : section.canvas;
              const assigned = waiters.find((waiter) => waiter.id === section.assignedStaffId);
              return (
                <section
                  key={section._id}
                  className="floor-section"
                  data-section={section._id}
                  style={{
                    left: `${preview.x}%`,
                    width: `${preview.width}%`,
                    top: `${(preview.y / floorUnits()) * 100}%`,
                    height: `${(preview.height / floorUnits()) * 100}%`,
                    zIndex: sectionDrag?.id === section._id ? 1000 : index + 1,
                  }}
                  aria-label={`Sección ${section.name}`}
                >
                  <header
                    className={`floor-section-head${editing ? " editing" : ""}`}
                    onPointerDown={editing ? (e) => startSectionDrag(e, section, "move") : undefined}
                    onPointerMove={editing ? moveSectionDrag : undefined}
                    onPointerUp={editing ? (e) => endSectionDrag(e, true) : undefined}
                    onPointerCancel={editing ? (e) => endSectionDrag(e, false) : undefined}
                  >
                    {editing && (
                      <button
                        type="button"
                        className="floor-handle"
                        aria-label={`Mover ${section.name}`}
                        onKeyDown={(e) => onSectionKey(e, section, "move")}
                      >
                        <Move aria-hidden="true" />
                      </button>
                    )}
                    <div className="floor-section-title">
                      <h2>{section.name}</h2>
                      <p>
                        {section.description ? `${section.description} · ` : ""}
                        {assigned ? `A cargo de ${assigned.name}` : "Sin mesero: avisos a caja"}
                      </p>
                    </div>
                    {editing && (
                      <div className="floor-section-actions">
                        <Button variant="outline" onClick={() => setEditor({ kind: "table", sectionId: section._id })}>
                          <Plus aria-hidden="true" />
                          Mesa
                        </Button>
                        <Button variant="ghost" onClick={() => setEditor({ kind: "section", id: section._id })}>
                          Editar
                        </Button>
                      </div>
                    )}
                  </header>
                  <div className="floor-section-body" data-section-body={section._id}>
                    {tablesIn(section._id).length ? (
                      tablesIn(section._id).map((table) => {
                        const position = tableDrag?.id === table._id ? tableDrag : table.canvas;
                        const meta = STATUS_META[table.status];
                        const dimmed = filter !== "all" && table.status !== filter;
                        return (
                          <button
                            key={table._id}
                            type="button"
                            data-table={table._id}
                            className={`floor-table ${meta.className}${dimmed ? " dim" : ""}${editing ? " editing" : ""}${tableDrag?.id === table._id ? " dragging" : ""}`}
                            style={{ left: `${position.x}%`, top: `${position.y}%` }}
                            aria-label={`${table.tableNumber}, ${meta.label}${editing ? ". Arrástrala o usa las flechas para moverla" : ""}`}
                            onClick={() => {
                              if (suppressTableClick.current) {
                                suppressTableClick.current = false;
                                return;
                              }
                              if (editing) {
                                setEditor({ kind: "table", id: table._id });
                              } else if (table.currentAccountId) {
                                router.push(`/cuenta/mesero/cuenta/${table.currentAccountId}`);
                              }
                            }}
                            onPointerDown={(e) => startTableDrag(e, table)}
                            onPointerMove={moveTableDrag}
                            onPointerUp={(e) => endTableDrag(e, true)}
                            onPointerCancel={(e) => endTableDrag(e, false)}
                            onKeyDown={(e) => onTableKey(e, table)}
                          >
                            <TableShape shape={table.shape} seats={table.seatCount} className="floor-table-svg" />
                            <span className="floor-table-name">{table.tableNumber}</span>
                            <span className="floor-table-sub">
                              {editing ? `${table.seatCount} pers.` : table.typeName ?? `${table.seatCount} pers.`}
                            </span>
                            {!editing && <span className={`floor-badge ${meta.className}`}>{meta.label}</span>}
                          </button>
                        );
                      })
                    ) : (
                      <p className="floor-empty-note">
                        {editing
                          ? "Agrega la primera mesa de esta sección."
                          : "Esta sección todavía no tiene mesas."}
                      </p>
                    )}
                  </div>
                  {editing && (
                    <button
                      type="button"
                      className="floor-resize"
                      aria-label={`Cambiar tamaño de ${section.name}`}
                      onPointerDown={(e) => startSectionDrag(e, section, "resize")}
                      onPointerMove={moveSectionDrag}
                      onPointerUp={(e) => endSectionDrag(e, true)}
                      onPointerCancel={(e) => endSectionDrag(e, false)}
                      onKeyDown={(e) => onSectionKey(e, section, "resize")}
                    >
                      <ChevronRight aria-hidden="true" />
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {!editing && (
        <div className="floor-legend" aria-label="Leyenda de estados">
          {FILTERS.slice(1).map((option) => (
            <span key={option.key}>
              <i className={STATUS_META[option.key as StatusKey].className} />
              {option.label}
            </span>
          ))}
        </div>
      )}
      {!embedded && (
        <LinkButton href="/cuenta" variant="outline">
          ← Cambiar de área
        </LinkButton>
      )}
    </div>
  );
}

function FormActions({
  onCancel,
  onSaveNew,
  saveLabel,
}: {
  onCancel: () => void;
  onSaveNew: () => void;
  saveLabel: string;
}) {
  return (
    <div className="floor-form-actions">
      <Button className="site-button" onClick={onSaveNew}>
        {saveLabel}
      </Button>
      <Button variant="outline" onClick={onCancel}>
        Cerrar
      </Button>
    </div>
  );
}
