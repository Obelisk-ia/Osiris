import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { emitNotification } from "./notifications";

export type PaymentMethod = Doc<"payments">["method"];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  vales: "Vales",
};

export function formatFolio(folio: number): string {
  return `A-${String(folio).padStart(4, "0")}`;
}

export function computeAccountAmounts(
  grossCents: number,
  discount?: { kind: "pct" | "amt"; value: number } | null,
): { grossCents: number; discountCents: number; totalCents: number } {
  const safeGross = Math.max(0, Math.round(grossCents));
  let discountCents = 0;
  if (discount && safeGross > 0) {
    if (discount.kind === "pct") {
      discountCents = Math.round((safeGross * discount.value) / 100);
    } else {
      discountCents = Math.round(discount.value);
    }
    discountCents = Math.max(0, Math.min(safeGross, discountCents));
  }
  return {
    grossCents: safeGross,
    discountCents,
    totalCents: Math.max(0, safeGross - discountCents),
  };
}

export async function loadAccountGrossCents(
  ctx: QueryCtx,
  account: Doc<"accounts">,
): Promise<{ grossCents: number; activeItemCount: number; activeUnits: number; hasUndelivered: boolean }> {
  const orders = await ctx.db
    .query("orders")
    .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
    .take(50);

  const admission = account.buffetAdmission;
  let grossCents = admission ? admission.adults * admission.adultCents + admission.children * admission.childCents : 0;
  let activeItemCount = 0;
  let activeUnits = 0;
  let hasUndelivered = false;

  for (const order of orders) {
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
      .take(100);
    for (const item of items) {
      if (item.status === "cancelled") continue;
      const mods = await ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItemId", (q) => q.eq("orderItemId", item._id))
        .take(30);
      const extraPerUnit = mods.reduce((sum, m) => sum + m.unitPriceExtraCents * m.quantity, 0);
      grossCents += (item.unitPriceCents + extraPerUnit) * item.quantity;
      activeItemCount += 1;
      activeUnits += item.quantity;
      const delivered =
        item.deliveredQuantity ?? (item.status === "delivered" ? item.quantity : 0);
      if (delivered < item.quantity) {
        hasUndelivered = true;
      }
    }
  }

  return { grossCents, activeItemCount, activeUnits, hasUndelivered };
}

export async function loadAccountPaymentTotals(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
): Promise<{
  paidCents: number;
  tipCents: number;
  confirmedCount: number;
  methods: PaymentMethod[];
  payments: Doc<"payments">[];
}> {
  const payments = await ctx.db
    .query("payments")
    .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
    .take(100);
  let paidCents = 0;
  let tipCents = 0;
  let confirmedCount = 0;
  const methodSet = new Set<PaymentMethod>();
  for (const payment of payments) {
    if (payment.status !== "confirmed") continue;
    paidCents += payment.amountCents;
    tipCents += payment.tipCents;
    confirmedCount += 1;
    methodSet.add(payment.method);
  }
  return {
    paidCents,
    tipCents,
    confirmedCount,
    methods: [...methodSet],
    payments,
  };
}

export async function recalculateAccountTotals(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
): Promise<{ grossCents: number; discountCents: number; totalCents: number; paidCents: number; tipCents: number }> {
  const account = await ctx.db.get("accounts", accountId);
  if (!account) {
    return { grossCents: 0, discountCents: 0, totalCents: 0, paidCents: 0, tipCents: 0 };
  }
  const [{ grossCents }, paymentTotals] = await Promise.all([
    loadAccountGrossCents(ctx, account),
    loadAccountPaymentTotals(ctx, accountId),
  ]);
  const discount =
    account.discountKind && account.discountValue !== undefined
      ? { kind: account.discountKind, value: account.discountValue }
      : null;
  const amounts = computeAccountAmounts(grossCents, discount);
  await ctx.db.patch("accounts", accountId, {
    discountCents: amounts.discountCents,
    totalCents: amounts.totalCents,
    paidCents: paymentTotals.paidCents,
    tipCents: paymentTotals.tipCents,
    updatedAt: Date.now(),
  });
  return {
    ...amounts,
    paidCents: paymentTotals.paidCents,
    tipCents: paymentTotals.tipCents,
  };
}

export async function findOpenShift(
  ctx: QueryCtx | MutationCtx,
  locationId: Id<"locations">,
): Promise<Doc<"cashShifts"> | null> {
  const recent = await ctx.db
    .query("cashShifts")
    .withIndex("by_locationId_and_openedAt", (q) => q.eq("locationId", locationId))
    .order("desc")
    .take(10);
  return recent.find((shift) => shift.closedAt === undefined) ?? null;
}

export async function computeShiftStats(
  ctx: QueryCtx,
  shift: Doc<"cashShifts">,
  staffNames?: Map<Id<"staff">, string>,
) {
  const [payments, movements] = await Promise.all([
    ctx.db
      .query("payments")
      .withIndex("by_shiftId", (q) => q.eq("shiftId", shift._id))
      .take(500),
    ctx.db
      .query("cashShiftMovements")
      .withIndex("by_shiftId", (q) => q.eq("shiftId", shift._id))
      .take(200),
  ]);

  const byMethod: Record<PaymentMethod, number> = {
    efectivo: 0,
    tarjeta: 0,
    transferencia: 0,
    vales: 0,
  };
  let salesCents = 0;
  let tipsCents = 0;
  let cashTipsCents = 0;
  let paymentCount = 0;

  for (const p of payments) {
    if (p.status !== "confirmed") continue;
    byMethod[p.method] += p.amountCents;
    salesCents += p.amountCents;
    tipsCents += p.tipCents;
    if (p.method === "efectivo") {
      cashTipsCents += p.tipCents;
    }
    paymentCount += 1;
  }

  let insCents = 0;
  let outsCents = 0;
  for (const m of movements) {
    if (m.kind === "ingreso") insCents += m.amountCents;
    else outsCents += m.amountCents;
  }

  const expectedCashCents =
    shift.fundCents + byMethod.efectivo + cashTipsCents + insCents - outsCents;

  const movementViews = movements
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({
      _id: m._id,
      kind: m.kind,
      amountCents: m.amountCents,
      reason: m.reason,
      createdAt: m.createdAt,
      createdByName: staffNames?.get(m.createdByStaffId) ?? "Equipo",
    }));

  return {
    byMethod,
    salesCents,
    tipsCents,
    cashTipsCents,
    insCents,
    outsCents,
    expectedCashCents,
    paymentCount,
    movements: movementViews,
  };
}

export async function accountDisplayLabel(
  ctx: QueryCtx,
  account: Doc<"accounts">,
): Promise<{ label: string; sectionName: string | null }> {
  if (account.diningTableId) {
    const table = await ctx.db.get("diningTables", account.diningTableId);
    if (table) {
      const section = await ctx.db.get("sections", table.sectionId);
      return { label: table.tableNumber, sectionName: section?.name ?? null };
    }
  }
  const kindLabel =
    account.kind === "takeaway"
      ? "Para llevar"
      : account.kind === "pickup"
        ? "Para recoger"
        : account.kind === "counter"
          ? "Barra"
          : "Cuenta";
  const label = account.customerName ? `${kindLabel} · ${account.customerName}` : kindLabel;
  return { label, sectionName: null };
}

export function hydrateReportedPayment(
  account: Doc<"accounts">,
  staffNames: Map<Id<"staff">, string>,
) {
  const rp = account.reportedPayment;
  if (!rp) return null;
  return {
    method: rp.method,
    receivedCents: rp.receivedCents,
    tipCents: rp.tipCents,
    terminalFolio: rp.terminalFolio ?? null,
    note: rp.note ?? null,
    reportedByName: staffNames.get(rp.reportedByStaffId) ?? "Mesero",
    reportedAt: rp.reportedAt,
  };
}

export async function closeAccountAndFreeTable(
  ctx: MutationCtx,
  account: Doc<"accounts">,
  closedBy: Doc<"staff">,
  now: number,
): Promise<{ label: string }> {
  await ctx.db.patch("accounts", account._id, {
    state: "closed",
    reportedPayment: undefined,
    closedAt: now,
    updatedAt: now,
  });

  let label = account.customerName ?? formatFolio(account.folio);
  if (account.diningTableId) {
    const table = await ctx.db.get("diningTables", account.diningTableId);
    if (table) {
      label = table.tableNumber;
      if (table.currentAccountId === account._id) {
        await ctx.db.patch("diningTables", table._id, {
          currentAccountId: undefined,
          assignedStaffId: undefined,
          status: "empty",
        });
      }
    }
  }

  if (account.assignedStaffId && account.assignedStaffId !== closedBy._id) {
    await emitNotification(ctx, {
      organizationId: closedBy.organizationId,
      locationId: closedBy.locationId,
      kind: "info",
      title: `${label}: cuenta cerrada y libre`,
      body: `Folio ${formatFolio(account.folio)} cobrado por ${closedBy.displayName}.`,
      targetStaffId: account.assignedStaffId,
      accountId: account._id,
      href: "/cuenta/mesas",
      actionLabel: "Ver mesas",
    });
  }

  return { label };
}
