import { v } from "convex/values";

export const operationalRole = v.union(
  v.literal("waiter"), v.literal("chef"), v.literal("bartender"),
  v.literal("barista"), v.literal("cashier"),
);
export const staffRole = v.union(v.literal("owner"), v.literal("manager"), operationalRole);
export const orderStatus = v.union(
  v.literal("ordered"), v.literal("preparing"), v.literal("ready"), v.literal("delivered"),
);
export const preparationStatus = v.union(v.literal("ordered"), v.literal("preparing"), v.literal("ready"));
export const accountState = v.union(
  v.literal("open"), v.literal("awaiting_payment"), v.literal("closed"), v.literal("voided"),
);
export const tableShape = v.union(
  v.literal("round"), v.literal("square"), v.literal("rectangle"), v.literal("oval"),
);
export const inventoryKind = v.union(
  v.literal("receipt"), v.literal("consumption"), v.literal("waste"),
  v.literal("adjustment"), v.literal("transfer_in"), v.literal("transfer_out"),
);
export const submissionState = v.union(v.literal("pending"), v.literal("accepted"), v.literal("rejected"));
export const canvas = v.object({
  x: v.number(), y: v.number(), width: v.number(), height: v.number(), rotation: v.number(),
});
export const workspace = v.union(
  v.literal("administracion"), v.literal("mesas"), v.literal("cocina"),
  v.literal("caja"), v.literal("buffet"),
);
export const preparationArea = v.union(
  v.literal("kitchen"), v.literal("bar"), v.literal("cocktails"), v.literal("coffee"),
);
