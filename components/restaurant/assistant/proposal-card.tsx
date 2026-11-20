"use client";

import { useMutation } from "convex/react";
import { Check, CheckCircle2, ChevronDown, ChevronUp, Loader2, X, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/format";
import {
  buffetBatchProposalSchema,
  floorBatchProposalSchema,
  floorLayoutChangesProposalSchema,
  inventoryBatchProposalSchema,
  inventoryEditsProposalSchema,
  inventoryReceiptProposalSchema,
  menuBatchProposalSchema,
  menuEditsProposalSchema,
  recipeBatchProposalSchema,
  sectionAssignmentsProposalSchema,
  type ProposalKind,
} from "@/lib/assistant-proposals";

export type AssistantProposalView = {
  _id: Id<"assistantProposals">;
  _creationTime: number;
  status: "pending" | "approved" | "rejected";
  kind: ProposalKind;
  title: string;
  summary: string;
  payload: string;
  resultSummary: string | null;
  decidedAt: number | null;
};

const KIND_LABELS: Record<ProposalKind, string> = {
  menu_batch: "Menú",
  menu_edits: "Edición de menú",
  inventory_batch: "Inventario",
  inventory_edits: "Edición de inventario",
  inventory_receipt: "Factura / Entrada",
  buffet_batch: "Buffet",
  floor_batch: "Mesas y plano",
  floor_layout_changes: "Edición de plano",
  section_assignments: "Asignación de turno",
  recipe_batch: "Recetas",
};

function ProposalDetails({
  kind,
  payload,
  currencyCode,
}: {
  kind: ProposalKind;
  payload: string;
  currencyCode: string;
}) {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return <p className="text-xs text-muted-foreground">No se pudo previsualizar el detalle.</p>;
  }

  if (kind === "menu_batch") {
    const parsed = menuBatchProposalSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap gap-2 text-muted-foreground">
          <span>
            {data.dishes.length} {data.dishes.length === 1 ? "platillo" : "platillos"}
          </span>
          {data.categories.length > 0 && (
            <span>
              · {data.categories.length} {data.categories.length === 1 ? "categoría" : "categorías"}
            </span>
          )}
          {data.modifierGroups.length > 0 && (
            <span>
              · {data.modifierGroups.length}{" "}
              {data.modifierGroups.length === 1 ? "grupo de modificadores" : "grupos de modificadores"}
            </span>
          )}
        </div>
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background/70">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Platillo</th>
                <th className="px-2 py-1.5 font-medium">Categoría</th>
                <th className="px-2 py-1.5 text-right font-medium">Precio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.dishes.map((dish, idx) => (
                <tr key={`${dish.name}-${idx}`}>
                  <td className="px-2 py-1.5 font-medium text-foreground">{dish.name}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{dish.categoryName ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    ${dish.price.toFixed(2)} {currencyCode}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (kind === "inventory_batch") {
    const parsed = inventoryBatchProposalSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap gap-2 text-muted-foreground">
          <span>{data.items.length} insumos</span>
          {data.suppliers.length > 0 && <span>· {data.suppliers.length} proveedores</span>}
        </div>
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background/70">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Insumo</th>
                <th className="px-2 py-1.5 font-medium">Unidad</th>
                <th className="px-2 py-1.5 text-right font-medium">Stock inicial</th>
                <th className="px-2 py-1.5 text-right font-medium">Costo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.items.map((item, idx) => (
                <tr key={`${item.name}-${idx}`}>
                  <td className="px-2 py-1.5 font-medium text-foreground">{item.name}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{item.unit}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {item.initialStock !== undefined ? item.initialStock : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {item.unitCost !== undefined ? `$${item.unitCost.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (kind === "buffet_batch") {
    const parsed = buffetBatchProposalSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div className="space-y-2 text-xs">
        {data.menus.map((menu, idx) => (
          <div key={`${menu.name}-${idx}`} className="rounded-lg border border-border bg-background/70 p-2">
            <div className="flex items-center justify-between font-medium">
              <span>{menu.name}</span>
              <span className="text-muted-foreground tabular-nums">{menu.menuDate}</span>
            </div>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {menu.dishes.map((d, dIdx) => (
                <li key={`${d.dishName}-${dIdx}`}>
                  • {d.dishName} ({d.destination}, {d.portionsPerTray} porc./charola)
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  if (kind === "floor_batch") {
    const parsed = floorBatchProposalSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap gap-2 text-muted-foreground">
          {data.sections.length > 0 && <span>{data.sections.length} secciones</span>}
          {data.tableTypes.length > 0 && <span>· {data.tableTypes.length} tipos</span>}
          <span>· {data.tables.length} mesas</span>
        </div>
        <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-background/70">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Mesa</th>
                <th className="px-2 py-1.5 font-medium">Sección</th>
                <th className="px-2 py-1.5 text-right font-medium">Asientos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.tables.map((table, idx) => (
                <tr key={`${table.sectionName}-${table.tableNumber}-${idx}`}>
                  <td className="px-2 py-1.5 font-medium text-foreground">{table.tableNumber}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{table.sectionName}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{table.seatCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (kind === "floor_layout_changes") {
    const parsed = floorLayoutChangesProposalSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div className="space-y-2 text-xs">
        {data.sectionMoves.length > 0 && (
          <div className="rounded-lg border border-border bg-background/70 p-2">
            <div className="font-medium text-foreground">
              Secciones ({data.sectionMoves.length})
            </div>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {data.sectionMoves.map((s, idx) => {
                const details: string[] = [];
                if (s.newName) details.push(`renombrar a "${s.newName}"`);
                if (s.x !== undefined || s.y !== undefined) details.push(`pos (${s.x ?? "—"}%, ${s.y ?? "—"})`);
                if (s.width !== undefined || s.height !== undefined) details.push(`${s.width ?? "—"}% × ${s.height ?? "—"}`);
                return (
                  <li key={`${s.sectionName}-${idx}`}>
                    • <span className="font-medium text-foreground">{s.sectionName}</span>
                    {details.length > 0 ? ` → ${details.join(" · ")}` : ""}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {data.tableMoves.length > 0 && (
          <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-background/70">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Mesa</th>
                  <th className="px-2 py-1.5 font-medium">Cambios</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.tableMoves.map((t, idx) => {
                  const changes: string[] = [];
                  if (t.newTableNumber) changes.push(`→ ${t.newTableNumber}`);
                  if (t.toSectionName) changes.push(`sección ${t.toSectionName}`);
                  if (t.shape) changes.push(`forma ${t.shape}`);
                  if (t.seatCount !== undefined) changes.push(`${t.seatCount} pers.`);
                  if (t.x !== undefined || t.y !== undefined) changes.push(`pos (${t.x ?? "—"}%, ${t.y ?? "—"}%)`);
                  return (
                    <tr key={`${t.tableNumber}-${idx}`}>
                      <td className="px-2 py-1.5 font-medium text-foreground">{t.tableNumber}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{changes.join(" · ") || "Actualización"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (kind === "menu_edits") {
    const parsed = menuEditsProposalSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background/70 text-xs">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Platillo</th>
              <th className="px-2 py-1.5 font-medium">Cambios</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.dishes.map((d, idx) => {
              const changes: string[] = [];
              if (d.newName) changes.push(`nombre → ${d.newName}`);
              if (d.price !== undefined) changes.push(`precio $${d.price.toFixed(2)} ${currencyCode}`);
              if (d.categoryName) changes.push(`categoría ${d.categoryName}`);
              if (d.description !== undefined) changes.push("descripción actualizada");
              if (d.photoStorageId) changes.push("foto adjunta");
              if (d.areas) changes.push(`áreas: ${d.areas.join(", ")}`);
              if (d.addModifierGroupNames?.length) changes.push(`+${d.addModifierGroupNames.join(", ")}`);
              return (
                <tr key={`${d.dishName}-${idx}`}>
                  <td className="px-2 py-1.5 font-medium text-foreground">{d.dishName}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{changes.join(" · ") || "Actualización"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (kind === "inventory_edits") {
    const parsed = inventoryEditsProposalSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background/70 text-xs">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Insumo</th>
              <th className="px-2 py-1.5 font-medium">Cambios</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.items.map((item, idx) => {
              const changes: string[] = [];
              if (item.newName) changes.push(`nombre → ${item.newName}`);
              if (item.unitCost !== undefined) changes.push(`costo $${item.unitCost.toFixed(2)} ${currencyCode}`);
              if (item.minStock !== undefined) changes.push(`mín ${item.minStock} ${item.unit ?? ""}`.trim());
              if (item.maxStock !== undefined) changes.push(`máx ${item.maxStock} ${item.unit ?? ""}`.trim());
              if (item.supplierName) changes.push(`proveedor ${item.supplierName}`);
              if (item.category) changes.push(`cat. ${item.category}`);
              return (
                <tr key={`${item.itemName}-${idx}`}>
                  <td className="px-2 py-1.5 font-medium text-foreground">{item.itemName}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{changes.join(" · ") || "Actualización"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (kind === "inventory_receipt") {
    const parsed = inventoryReceiptProposalSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div className="space-y-2 text-xs">
        {(data.supplierName || data.invoiceRef) && (
          <div className="flex flex-wrap gap-2 text-muted-foreground">
            {data.supplierName && <span>Proveedor: <strong className="text-foreground">{data.supplierName}</strong></span>}
            {data.invoiceRef && <span>· Folio: <strong className="text-foreground">{data.invoiceRef}</strong></span>}
          </div>
        )}
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background/70">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Insumo</th>
                <th className="px-2 py-1.5 text-right font-medium">Entrada</th>
                <th className="px-2 py-1.5 text-right font-medium">Costo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.items.map((line, idx) => (
                <tr key={`${line.itemName}-${idx}`}>
                  <td className="px-2 py-1.5 font-medium text-foreground">{line.itemName}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    +{line.quantity} {line.unit}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {line.unitCost !== undefined ? `$${line.unitCost.toFixed(2)} ${currencyCode}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (kind === "section_assignments") {
    const parsed = sectionAssignmentsProposalSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-background/70 text-xs">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-muted/80 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Sección</th>
              <th className="px-2 py-1.5 font-medium">Mesero asignado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.assignments.map((pair, idx) => (
              <tr key={`${pair.sectionName}-${idx}`}>
                <td className="px-2 py-1.5 font-medium text-foreground">{pair.sectionName}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{pair.waiterName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (kind === "recipe_batch") {
    const parsed = recipeBatchProposalSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div className="max-h-52 space-y-2 overflow-y-auto text-xs">
        {data.recipes.map((recipe, idx) => (
          <div key={`${recipe.dishName}-${idx}`} className="rounded-lg border border-border bg-background/70 p-2">
            <div className="font-medium text-foreground">{recipe.dishName}</div>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {recipe.ingredients.map((ing, iIdx) => (
                <li key={`${ing.name}-${iIdx}`}>
                  • {ing.name}: {ing.quantity} {ing.unit}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

export function ProposalCard({
  proposal,
  currencyCode,
}: {
  proposal: AssistantProposalView;
  currencyCode: string;
}) {
  const approve = useMutation(api.assistant.approveProposal);
  const reject = useMutation(api.assistant.rejectProposal);
  const [expanded, setExpanded] = useState(proposal.status === "pending");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setBusy("approve");
    setError(null);
    try {
      await approve({ proposalId: proposal._id });
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo aplicar la propuesta."));
    } finally {
      setBusy(null);
    }
  }

  async function handleReject() {
    setBusy("reject");
    setError(null);
    try {
      await reject({ proposalId: proposal._id });
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo descartar la propuesta."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {KIND_LABELS[proposal.kind]}
            </span>
            {proposal.status === "approved" && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                <CheckCircle2 className="size-3.5" /> Aplicada
              </span>
            )}
            {proposal.status === "rejected" && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <XCircle className="size-3.5" /> Descartada
              </span>
            )}
          </div>
          <h4 className="mt-1 text-sm font-semibold text-foreground">{proposal.title}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{proposal.summary}</p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={expanded ? "Ocultar detalle" : "Ver detalle"}
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2.5">
          <ProposalDetails kind={proposal.kind} payload={proposal.payload} currencyCode={currencyCode} />
        </div>
      )}

      {proposal.resultSummary && (
        <p className="mt-2 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          {proposal.resultSummary}
        </p>
      )}

      {error && (
        <p className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{error}</p>
      )}

      {proposal.status === "pending" && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy !== null}
            onClick={() => void handleApprove()}
            className="flex-1 gap-1.5"
          >
            {busy === "approve" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {proposal.kind === "floor_layout_changes" ||
            proposal.kind === "recipe_batch" ||
            proposal.kind === "menu_edits" ||
            proposal.kind === "inventory_edits" ||
            proposal.kind === "inventory_receipt" ||
            proposal.kind === "section_assignments"
              ? "Confirmar y aplicar"
              : "Confirmar y crear"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void handleReject()}
            className="gap-1"
          >
            {busy === "reject" ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
            Descartar
          </Button>
        </div>
      )}
    </div>
  );
}
