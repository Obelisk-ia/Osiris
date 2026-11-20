import { v } from "convex/values";

export const operationalRole = v.union(
  v.literal("waiter"), v.literal("chef"), v.literal("bar"), v.literal("bartender"),
  v.literal("barista"), v.literal("cashier"),
);
export const stationRole = v.union(
  v.literal("chef"), v.literal("bar"), v.literal("bartender"), v.literal("barista"),
);
export const staffRole = v.union(v.literal("owner"), v.literal("manager"), operationalRole);
export const orderStatus = v.union(
  v.literal("ordered"), v.literal("preparing"), v.literal("ready"), v.literal("delivered"), v.literal("cancelled"),
);
export const preparationStatus = v.union(
  v.literal("ordered"), v.literal("preparing"), v.literal("ready"), v.literal("delivered"), v.literal("cancelled"),
);
export const notificationKind = v.union(
  v.literal("ready"),
  v.literal("order"),
  v.literal("cancel"),
  v.literal("bill"),
  v.literal("reassign"),
  v.literal("late"),
  v.literal("info"),
);
export const tableStatus = v.union(
  v.literal("empty"), v.literal("occupied"), v.literal("partial"), v.literal("attended"), v.literal("payment"),
);
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
export const serviceMode = v.union(v.literal("a_la_carte"), v.literal("buffet"), v.literal("mixed"));
export const buffetPrices = v.object({ adultCents: v.number(), childCents: v.union(v.number(), v.null()) });
export const menuBackgroundSetting = v.union(
  v.object({ kind: v.literal("color"), color: v.string() }),
  v.object({ kind: v.literal("photo"), storageId: v.id("_storage") }),
);
export const menuBackgroundView = v.union(
  v.object({ kind: v.literal("default") }),
  v.object({ kind: v.literal("color"), color: v.string() }),
  v.object({ kind: v.literal("photo"), url: v.string() }),
);
export const buffetAdmission = v.object({
  adults: v.number(), children: v.number(), adultCents: v.number(), childCents: v.number(),
});
export const paymentMethod = v.union(
  v.literal("efectivo"),
  v.literal("tarjeta"),
  v.literal("transferencia"),
  v.literal("vales"),
);
export const paymentStatus = v.union(v.literal("confirmed"), v.literal("reverted"));
export const cashMovementKind = v.union(v.literal("ingreso"), v.literal("retiro"));
export const discountKind = v.union(v.literal("pct"), v.literal("amt"));
export const reportedPayment = v.object({
  method: paymentMethod,
  receivedCents: v.number(),
  tipCents: v.number(),
  terminalFolio: v.optional(v.string()),
  note: v.optional(v.string()),
  reportedByStaffId: v.id("staff"),
  reportedAt: v.number(),
});
export const reportedPaymentView = v.object({
  method: paymentMethod,
  receivedCents: v.number(),
  tipCents: v.number(),
  terminalFolio: v.union(v.string(), v.null()),
  note: v.union(v.string(), v.null()),
  reportedByName: v.string(),
  reportedAt: v.number(),
});
