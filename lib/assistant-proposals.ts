import { z } from "zod";

export const PREPARATION_AREA_VALUES = ["kitchen", "bar", "cocktails", "coffee"] as const;
export const TABLE_SHAPE_VALUES = ["round", "square", "rectangle", "oval"] as const;
export const INVENTORY_UNIT_VALUES = ["g", "ml", "each"] as const;

export const MICROS_PER_UNIT = 1_000_000;

export function normalizeNameKey(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Converts a human-readable quantity + unit string (e.g. "2.5", "kg") into
 * Osiris's canonical storage unit ("g" | "ml" | "each") and safe integer micros.
 */
export function convertQuantityToMicros(
  quantity: number,
  rawUnit: string,
): { unit: "g" | "ml" | "each"; micros: number } {
  const safeQty = Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
  const u = normalizeNameKey(rawUnit).replace(/\.$/, "");

  if (["kg", "kilo", "kilos", "kilogramo", "kilogramos"].includes(u)) {
    return { unit: "g", micros: Math.round(safeQty * 1000 * MICROS_PER_UNIT) };
  }
  if (["g", "gr", "grs", "gramo", "gramos"].includes(u)) {
    return { unit: "g", micros: Math.round(safeQty * MICROS_PER_UNIT) };
  }
  if (["mg", "miligramo", "miligramos"].includes(u)) {
    return { unit: "g", micros: Math.round((safeQty / 1000) * MICROS_PER_UNIT) };
  }
  if (["lb", "lbs", "libra", "libras"].includes(u)) {
    return { unit: "g", micros: Math.round(safeQty * 453.592 * MICROS_PER_UNIT) };
  }
  if (["oz", "onza", "onzas"].includes(u)) {
    return { unit: "g", micros: Math.round(safeQty * 28.3495 * MICROS_PER_UNIT) };
  }
  if (["l", "lt", "lts", "litro", "litros"].includes(u)) {
    return { unit: "ml", micros: Math.round(safeQty * 1000 * MICROS_PER_UNIT) };
  }
  if (["ml", "mililitro", "mililitros", "cc"].includes(u)) {
    return { unit: "ml", micros: Math.round(safeQty * MICROS_PER_UNIT) };
  }
  if (["gal", "galon", "galones"].includes(u)) {
    return { unit: "ml", micros: Math.round(safeQty * 3785.41 * MICROS_PER_UNIT) };
  }
  return { unit: "each", micros: Math.round(safeQty * MICROS_PER_UNIT) };
}

export function formatMicrosDisplay(micros: number, unit: "g" | "ml" | "each"): string {
  const base = micros / MICROS_PER_UNIT;
  if (unit === "g" && Math.abs(base) >= 1000) {
    return `${Number((base / 1000).toFixed(2))} kg`;
  }
  if (unit === "ml" && Math.abs(base) >= 1000) {
    return `${Number((base / 1000).toFixed(2))} L`;
  }
  const label = unit === "each" ? "pz" : unit;
  return `${Number(base.toFixed(2))} ${label}`;
}

export function priceToCents(price: number): number {
  if (!Number.isFinite(price) || price < 0) return 0;
  return Math.round(price * 100);
}

/* ───────── Proposal Payload Schemas ───────── */

export const menuBatchProposalSchema = z.object({
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
      }),
    )
    .default([]),
  modifierGroups: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        minSelections: z.number().int().min(0).default(0),
        maxSelections: z.number().int().min(1).optional(),
        options: z
          .array(
            z.object({
              name: z.string().min(1).max(80),
              priceExtra: z.number().min(0).default(0),
            }),
          )
          .min(1),
      }),
    )
    .default([]),
  dishes: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(400).optional(),
        price: z.number().min(0).describe("Price in restaurant currency (e.g. 145.50, NOT cents)"),
        categoryName: z.string().max(80).optional(),
        areas: z.array(z.enum(PREPARATION_AREA_VALUES)).min(1).default(["kitchen"]),
        buffetExtra: z.boolean().optional(),
        isPublished: z.boolean().default(true),
        photoStorageId: z.string().optional().describe("Optional storageId of an uploaded dish photo"),
        modifierGroupNames: z.array(z.string()).optional(),
        ingredients: z
          .array(
            z.object({
              name: z.string().min(1).max(80),
              quantityText: z.string().max(60).optional(),
              inventoryQuantity: z.number().positive().optional(),
              inventoryUnit: z.string().max(20).optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1),
});

export const inventoryBatchProposalSchema = z.object({
  suppliers: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        contact: z.string().max(150).optional(),
      }),
    )
    .default([]),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        unit: z.string().min(1).max(30).describe("Unit from sheet or canonical: g, kg, ml, L, each, pz"),
        category: z.string().max(80).optional(),
        supplierName: z.string().max(100).optional(),
        presentation: z.string().max(80).optional(),
        initialStock: z.number().min(0).optional(),
        minStock: z.number().min(0).optional(),
        maxStock: z.number().min(0).optional(),
        unitCost: z.number().min(0).optional().describe("Cost in restaurant currency (NOT cents)"),
      }),
    )
    .min(1),
});

export const buffetBatchProposalSchema = z.object({
  menus: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        menuDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
        dishes: z
          .array(
            z.object({
              dishName: z.string().min(1).max(100),
              description: z.string().max(300).optional(),
              categoryName: z.string().max(80).optional(),
              areas: z.array(z.enum(PREPARATION_AREA_VALUES)).optional(),
              destination: z.string().max(80).default("Línea de buffet"),
              portionsPerTray: z.number().int().min(1).default(12),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export const floorBatchProposalSchema = z.object({
  sections: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(200).optional(),
      }),
    )
    .default([]),
  tableTypes: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        shape: z.enum(TABLE_SHAPE_VALUES).default("square"),
        seatCount: z.number().int().min(1).max(30).default(4),
      }),
    )
    .default([]),
  tables: z
    .array(
      z.object({
        sectionName: z.string().min(1).max(80),
        tableNumber: z.string().min(1).max(40),
        seatCount: z.number().int().min(1).max(30).default(4),
        shape: z.enum(TABLE_SHAPE_VALUES).default("square"),
        tableTypeName: z.string().max(80).optional(),
      }),
    )
    .min(1),
});

export const floorLayoutChangesProposalSchema = z
  .object({
    sectionMoves: z
      .array(
        z.object({
          sectionName: z.string().min(1).max(80),
          newName: z.string().min(1).max(80).optional(),
          description: z.string().max(200).optional(),
          x: z.number().min(0).max(90).optional(),
          y: z.number().min(0).max(990).optional(),
          width: z.number().min(10).max(100).optional(),
          height: z.number().min(8).max(500).optional(),
        }),
      )
      .default([]),
    tableMoves: z
      .array(
        z.object({
          tableNumber: z.string().min(1).max(40),
          newTableNumber: z.string().min(1).max(40).optional(),
          fromSectionName: z.string().min(1).max(80).optional(),
          toSectionName: z.string().min(1).max(80).optional(),
          x: z.number().min(8).max(92).optional().describe("Horizontal position % inside section (8-92)"),
          y: z.number().min(12).max(88).optional().describe("Vertical position % inside section (12-88)"),
          seatCount: z.number().int().min(1).max(30).optional(),
          shape: z.enum(TABLE_SHAPE_VALUES).optional(),
          tableTypeName: z.string().max(80).optional(),
        }),
      )
      .default([]),
  })
  .refine((v) => v.sectionMoves.length > 0 || v.tableMoves.length > 0, {
    message: "Incluye al menos una sección o mesa para editar o mover.",
  });

export const menuEditsProposalSchema = z.object({
  dishes: z
    .array(
      z.object({
        dishName: z.string().min(1).max(100).describe("Exact current name of the existing dish"),
        newName: z.string().min(1).max(100).optional(),
        description: z.string().max(400).optional(),
        price: z.number().min(0).optional().describe("New price in restaurant currency (NOT cents)"),
        categoryName: z.string().max(80).optional(),
        areas: z.array(z.enum(PREPARATION_AREA_VALUES)).min(1).optional(),
        isAvailable: z.boolean().optional(),
        isPublished: z.boolean().optional(),
        buffetExtra: z.boolean().optional(),
        photoStorageId: z
          .string()
          .optional()
          .describe("storageId of an uploaded image to attach as this dish's photo"),
        addModifierGroupNames: z.array(z.string()).optional(),
      }),
    )
    .min(1),
});

export const inventoryEditsProposalSchema = z.object({
  items: z
    .array(
      z.object({
        itemName: z.string().min(1).max(100).describe("Exact current name of the existing inventory item"),
        newName: z.string().min(1).max(100).optional(),
        category: z.string().max(80).optional(),
        presentation: z.string().max(80).optional(),
        supplierName: z.string().max(100).optional(),
        unit: z.string().max(30).optional().describe("Unit for minStock/maxStock values (defaults to item's canonical unit)"),
        minStock: z.number().min(0).optional(),
        maxStock: z.number().min(0).optional(),
        unitCost: z.number().min(0).optional().describe("Updated cost in restaurant currency (NOT cents)"),
      }),
    )
    .min(1),
});

export const recipeBatchProposalSchema = z.object({
  recipes: z
    .array(
      z.object({
        dishName: z.string().min(1).max(100),
        ingredients: z
          .array(
            z.object({
              name: z.string().min(1).max(100),
              quantity: z.number().positive(),
              unit: z.string().min(1).max(30).describe("e.g. g, kg, ml, L, pz, each"),
              quantityText: z.string().max(60).optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export const inventoryReceiptProposalSchema = z.object({
  invoiceRef: z.string().max(100).optional().describe("Folio o referencia de la factura/nota de remisión"),
  supplierName: z.string().max(100).optional(),
  items: z
    .array(
      z.object({
        itemName: z.string().min(1).max(100),
        quantity: z.number().positive(),
        unit: z.string().min(1).max(30).describe("Unidad recibida: kg, g, L, ml, pz, each"),
        unitCost: z
          .number()
          .min(0)
          .optional()
          .describe("Nuevo costo unitario por presentación (kg/L/pz) en moneda del restaurante"),
        category: z.string().max(80).optional(),
      }),
    )
    .min(1),
});

export const sectionAssignmentsProposalSchema = z.object({
  assignments: z
    .array(
      z.object({
        sectionName: z.string().min(1).max(80),
        waiterName: z.string().min(1).max(100).describe("Nombre exacto del mesero activo en esta sucursal"),
      }),
    )
    .min(1),
});

export type MenuBatchProposal = z.infer<typeof menuBatchProposalSchema>;
export type MenuEditsProposal = z.infer<typeof menuEditsProposalSchema>;
export type InventoryBatchProposal = z.infer<typeof inventoryBatchProposalSchema>;
export type InventoryEditsProposal = z.infer<typeof inventoryEditsProposalSchema>;
export type InventoryReceiptProposal = z.infer<typeof inventoryReceiptProposalSchema>;
export type BuffetBatchProposal = z.infer<typeof buffetBatchProposalSchema>;
export type FloorBatchProposal = z.infer<typeof floorBatchProposalSchema>;
export type FloorLayoutChangesProposal = z.infer<typeof floorLayoutChangesProposalSchema>;
export type SectionAssignmentsProposal = z.infer<typeof sectionAssignmentsProposalSchema>;
export type RecipeBatchProposal = z.infer<typeof recipeBatchProposalSchema>;

export type ProposalKind =
  | "menu_batch"
  | "menu_edits"
  | "inventory_batch"
  | "inventory_edits"
  | "inventory_receipt"
  | "buffet_batch"
  | "floor_batch"
  | "floor_layout_changes"
  | "section_assignments"
  | "recipe_batch";
