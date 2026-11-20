import { describe, expect, it } from "vitest";
import {
  buffetBatchProposalSchema,
  convertQuantityToMicros,
  floorBatchProposalSchema,
  formatMicrosDisplay,
  inventoryBatchProposalSchema,
  menuBatchProposalSchema,
  MICROS_PER_UNIT,
  priceToCents,
} from "./assistant-proposals";

describe("assistant-proposals helpers", () => {
  it("converts Spanish and English weight/volume/count units to canonical micros", () => {
    expect(convertQuantityToMicros(2.5, "kg")).toEqual({
      unit: "g",
      micros: 2500 * MICROS_PER_UNIT,
    });
    expect(convertQuantityToMicros(500, "grs")).toEqual({
      unit: "g",
      micros: 500 * MICROS_PER_UNIT,
    });
    expect(convertQuantityToMicros(1.5, "Litros")).toEqual({
      unit: "ml",
      micros: 1500 * MICROS_PER_UNIT,
    });
    expect(convertQuantityToMicros(12, "pzas")).toEqual({
      unit: "each",
      micros: 12 * MICROS_PER_UNIT,
    });
  });

  it("formats micros cleanly back to display strings", () => {
    expect(formatMicrosDisplay(2500 * MICROS_PER_UNIT, "g")).toBe("2.5 kg");
    expect(formatMicrosDisplay(750 * MICROS_PER_UNIT, "ml")).toBe("750 ml");
    expect(formatMicrosDisplay(4 * MICROS_PER_UNIT, "each")).toBe("4 pz");
  });

  it("converts currency prices to safe integer cents", () => {
    expect(priceToCents(145.5)).toBe(14550);
    expect(priceToCents(0)).toBe(0);
    expect(priceToCents(-5)).toBe(0);
  });

  it("validates menu, inventory, buffet, and floor batch proposals", () => {
    const menu = menuBatchProposalSchema.parse({
      categories: [{ name: "Entradas" }],
      dishes: [{ name: "Guacamole", price: 120, categoryName: "Entradas", areas: ["kitchen"] }],
    });
    expect(menu.dishes[0].isPublished).toBe(true);

    const inv = inventoryBatchProposalSchema.parse({
      items: [{ name: "Aguacate", unit: "kg", initialStock: 10, minStock: 2, unitCost: 85 }],
    });
    expect(inv.items).toHaveLength(1);

    const buffet = buffetBatchProposalSchema.parse({
      menus: [
        {
          name: "Buffet Desayuno",
          menuDate: "2026-11-20",
          dishes: [{ dishName: "Chilaquiles" }],
        },
      ],
    });
    expect(buffet.menus[0].dishes[0].portionsPerTray).toBe(12);

    const floor = floorBatchProposalSchema.parse({
      sections: [{ name: "Terraza" }],
      tables: [{ sectionName: "Terraza", tableNumber: "T1", seatCount: 4, shape: "round" }],
    });
    expect(floor.tables[0].shape).toBe("round");
  });
});
