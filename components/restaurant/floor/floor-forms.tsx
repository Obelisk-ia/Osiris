"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Section = Doc<"sections"> & { assignedStaffId: Id<"staff"> | null; tableCount: number };
type Table = Doc<"diningTables">;
type TableType = Doc<"tableTypes">;
type Waiter = { id: Id<"staff">; name: string };

const shapes: Array<{ value: Table["shape"]; label: string }> = [
  { value: "round", label: "Redonda" },
  { value: "square", label: "Cuadrada" },
  { value: "rectangle", label: "Rectangular" },
  { value: "oval", label: "Ovalada" },
];

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="floor-field">
      <Label>{label}</Label>
      {children}
      {hint && <small className="small-note">{hint}</small>}
    </div>
  );
}

function FormActions({ onCancel, onDelete, saveLabel, pending }: {
  onCancel: () => void; onDelete?: () => void; saveLabel: string; pending: boolean;
}) {
  return (
    <div className="floor-form-actions">
      <Button type="submit" className="site-button" disabled={pending}>{pending ? "Guardando…" : saveLabel}</Button>
      <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
      {onDelete && <Button type="button" variant="ghost" onClick={onDelete}>Quitar</Button>}
    </div>
  );
}

export function SectionForm({ section, waiters, defaultCanvas, onLayer, onSave, onDelete, onCancel }: {
  section?: Section; waiters: Waiter[];
  defaultCanvas?: { x: number; y: number; width: number; height: number };
  onLayer?: (layer: "front" | "back") => Promise<void>;
  onSave: (values: {
    name: string; description: string; assignedStaffId?: Id<"staff">;
    canvas: { x: number; y: number; width: number; height: number };
  }) => Promise<void>;
  onDelete?: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState(section?.name ?? "");
  const [description, setDescription] = useState(section?.description ?? "");
  const [waiter, setWaiter] = useState<string>(section?.assignedStaffId ?? "");
  const canvas = {
    x: section?.canvas.x ?? defaultCanvas?.x ?? 1,
    y: section?.canvas.y ?? defaultCanvas?.y ?? 1,
    width: section?.canvas.width ?? defaultCanvas?.width ?? 48,
    height: section?.canvas.height ?? defaultCanvas?.height ?? 28,
  };
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSave({ name, description, assignedStaffId: waiter ? waiter as Id<"staff"> : undefined, canvas });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos guardar la sección.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="floor-form" onSubmit={submit}>
      <h3>{section ? `Editar ${section.name}` : "Nueva sección"}</h3>
      <Field label="Nombre"><Input aria-label="Nombre de la sección" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus placeholder="Salón, Terraza, Barra…" /></Field>
      <Field label="Descripción"><Input aria-label="Descripción de la sección" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={80} placeholder="Segundo piso, junto a la ventana…" /></Field>
      <Field label="Mesero a cargo" hint="Sin mesero, los avisos van a caja.">
        <select aria-label="Mesero a cargo" className="floor-select" value={waiter} onChange={(e) => setWaiter(e.target.value)}>
          <option value="">Sin mesero</option>
          {waiters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <p className="small-note">La sección aparece en un lugar libre del plano. Luego la arrastras desde su barra y ajustas su tamaño desde la esquina. Puedes superponer secciones: la que arrastres pasa al frente.</p>
      {section && onLayer && (
        <div className="floor-form-actions">
          <Button type="button" variant="outline" onClick={() => void onLayer("front")}>Traer al frente</Button>
          <Button type="button" variant="outline" onClick={() => void onLayer("back")}>Enviar al fondo</Button>
        </div>
      )}
      {error && <p className="floor-error" role="alert">{error}</p>}
      <FormActions onCancel={onCancel} onDelete={onDelete} saveLabel={section ? "Guardar sección" : "Agregar sección"} pending={pending} />
    </form>
  );
}

export function TableForm({ table, sections, types, defaultName, defaultSectionId, defaultPosition, status, onStatusChange, onSave, onDelete, onCancel }: {
  table?: Table; sections: Section[]; types: TableType[];
  defaultName?: string; defaultSectionId?: Id<"sections">; defaultPosition?: { x: number; y: number };
  status?: Table["status"]; onStatusChange?: (status: Table["status"]) => Promise<void>;
  onSave: (values: {
    sectionId: Id<"sections">; tableTypeId?: Id<"tableTypes">; tableNumber: string; x: number; y: number;
  }) => Promise<void>;
  onDelete?: () => void; onCancel: () => void;
}) {
  const [tableNumber, setTableNumber] = useState(table?.tableNumber ?? defaultName ?? "Mesa 1");
  const [sectionId, setSectionId] = useState<string>(defaultSectionId ?? table?.sectionId ?? sections[0]?._id ?? "");
  const [typeId, setTypeId] = useState(table?.tableTypeId ?? "");
  const position = {
    x: defaultPosition?.x ?? table?.canvas.x ?? 50,
    y: defaultPosition?.y ?? table?.canvas.y ?? 50,
  };
  const [statusValue, setStatusValue] = useState<Table["status"]>(status ?? "empty");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSave({ sectionId: sectionId as Id<"sections">, tableTypeId: typeId ? typeId as Id<"tableTypes"> : undefined, tableNumber, ...position });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos guardar la mesa.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="floor-form" onSubmit={submit}>
      <h3>{table ? `Editar ${table.tableNumber}` : "Nueva mesa"}</h3>
      <Field label="Nombre de la mesa"><Input aria-label="Nombre de la mesa" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} maxLength={40} required autoFocus placeholder="Mesa 1" /></Field>
      <Field label="Sección">
        <select aria-label="Sección de la mesa" className="floor-select" value={sectionId} onChange={(e) => setSectionId(e.target.value)} required>
          {sections.map((section) => <option key={section._id} value={section._id}>{section.name}</option>)}
        </select>
      </Field>
      <Field label="Tipo de mesa" hint="Define la forma y el número de sillas.">
        <select aria-label="Tipo de mesa" className="floor-select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Personalizada</option>
          {types.filter((type) => type.isActive).map((type) => (
            <option key={type._id} value={type._id}>{type.name} · {type.seatCount} pers.</option>
          ))}
        </select>
      </Field>
      <p className="small-note">La mesa aparece en un lugar libre de su sección. Arrástrala para colocarla donde quieras.</p>
      {status && onStatusChange && (
        <Field label="Estado (vista previa)" hint="Cuando la mesa tenga una cuenta, el estado se calculará solo.">
          <select aria-label="Estado de la mesa" className="floor-select" value={statusValue}
            onChange={(e) => {
              const next = e.target.value as Table["status"];
              setStatusValue(next);
              void onStatusChange(next).catch((cause) => {
                setStatusValue(statusValue);
                setError(cause instanceof Error ? cause.message : "No pudimos cambiar el estado.");
              });
            }}>
            <option value="empty">Libre</option>
            <option value="occupied">Ocupada</option>
            <option value="partial">Entrega parcial</option>
            <option value="attended">Pedido listo</option>
            <option value="payment">Quieren pagar</option>
          </select>
        </Field>
      )}
      {error && <p className="floor-error" role="alert">{error}</p>}
      <FormActions onCancel={onCancel} onDelete={onDelete} saveLabel={table ? "Guardar mesa" : "Agregar mesa"} pending={pending} />
    </form>
  );
}

export function TableTypeForm({ type, onSave, onDelete, onCancel }: {
  type?: TableType;
  onSave: (values: {
    name: string; shape: TableType["shape"]; seatCount: number; isActive: boolean;
  }) => Promise<void>;
  onDelete?: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState(type?.name ?? "");
  const [shape, setShape] = useState<TableType["shape"]>(type?.shape ?? "square");
  const [seats, setSeats] = useState(type?.seatCount ?? 4);
  const [isActive, setIsActive] = useState(type?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSave({ name, shape, seatCount: seats, isActive });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos guardar el tipo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="floor-form" onSubmit={submit}>
      <h3>{type ? `Editar ${type.name}` : "Nuevo tipo de mesa"}</h3>
      <Field label="Nombre"><Input aria-label="Nombre del tipo" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus placeholder="Redonda de 4" /></Field>
      <Field label="Forma">
        <select aria-label="Forma del tipo" className="floor-select" value={shape} onChange={(e) => setShape(e.target.value as TableType["shape"])}>
          {shapes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </Field>
      <Field label="Sillas"><Input aria-label="Sillas del tipo" type="number" min={1} max={12} value={seats} onChange={(e) => setSeats(Number(e.target.value))} /></Field>
      <label className="floor-check"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Activo para nuevas mesas</label>
      {error && <p className="floor-error" role="alert">{error}</p>}
      <FormActions onCancel={onCancel} onDelete={onDelete} saveLabel={type ? "Guardar tipo" : "Crear tipo"} pending={pending} />
    </form>
  );
}
