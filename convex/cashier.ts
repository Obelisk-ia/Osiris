import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireStaff, requiredText, safeInteger } from "./model/access";
import {
  accountDisplayLabel,
  closeAccountAndFreeTable,
  computeAccountAmounts,
  computeShiftStats,
  findOpenShift,
  formatFolio,
  hydrateReportedPayment,
  loadAccountGrossCents,
  loadAccountPaymentTotals,
  recalculateAccountTotals,
  type PaymentMethod,
} from "./model/billing";
import { emitNotification } from "./model/notifications";
import {
  accountState,
  cashMovementKind,
  discountKind,
  paymentMethod,
  reportedPaymentView,
} from "./model/validators";

const CASHIER_ROLES = ["cashier", "owner", "manager"] as const;
const ADMIN_ROLES = ["owner", "manager"] as const;

async function cashierStaff(ctx: QueryCtx | MutationCtx) {
  return await requireStaff(ctx, undefined, undefined, CASHIER_ROLES);
}

async function adminStaff(ctx: QueryCtx | MutationCtx) {
  return await requireStaff(ctx, undefined, undefined, ADMIN_ROLES);
}

const byMethodValidator = v.object({
  efectivo: v.number(),
  tarjeta: v.number(),
  transferencia: v.number(),
  vales: v.number(),
});

const shiftMovementValidator = v.object({
  _id: v.id("cashShiftMovements"),
  kind: cashMovementKind,
  amountCents: v.number(),
  reason: v.string(),
  createdAt: v.number(),
  createdByName: v.string(),
});

const activeShiftValidator = v.object({
  _id: v.id("cashShifts"),
  cashierName: v.string(),
  openedAt: v.number(),
  fundCents: v.number(),
  expectedCashCents: v.number(),
  salesCents: v.number(),
  tipsCents: v.number(),
  cashTipsCents: v.number(),
  insCents: v.number(),
  outsCents: v.number(),
  paymentCount: v.number(),
  byMethod: byMethodValidator,
  movements: v.array(shiftMovementValidator),
});

const pastShiftValidator = v.object({
  _id: v.id("cashShifts"),
  cashierName: v.string(),
  closedByName: v.string(),
  openedAt: v.number(),
  closedAt: v.number(),
  fundCents: v.number(),
  expectedCashCents: v.number(),
  countedCashCents: v.number(),
  diffCents: v.number(),
  salesCents: v.number(),
  tipsCents: v.number(),
  insCents: v.number(),
  outsCents: v.number(),
  paymentCount: v.number(),
  byMethod: byMethodValidator,
});

const chargeableAccountValidator = v.object({
  _id: v.id("accounts"),
  folio: v.number(),
  kind: v.union(v.literal("dine_in"), v.literal("counter"), v.literal("takeaway"), v.literal("pickup")),
  state: accountState,
  label: v.string(),
  sectionName: v.union(v.string(), v.null()),
  customerName: v.union(v.string(), v.null()),
  assignedStaffName: v.union(v.string(), v.null()),
  openedAt: v.number(),
  billRequestedAt: v.union(v.number(), v.null()),
  totalCents: v.number(),
  discountKind: v.union(discountKind, v.null()),
  discountValue: v.union(v.number(), v.null()),
  discountCents: v.number(),
  discountReason: v.union(v.string(), v.null()),
  paidCents: v.number(),
  tipCents: v.number(),
  balanceCents: v.number(),
  itemCount: v.number(),
  buffetGuestCount: v.number(),
  hasUndelivered: v.boolean(),
  paymentsCount: v.number(),
  reportedPayment: v.union(reportedPaymentView, v.null()),
});

const closedAccountValidator = v.object({
  _id: v.id("accounts"),
  folio: v.number(),
  kind: v.union(v.literal("dine_in"), v.literal("counter"), v.literal("takeaway"), v.literal("pickup")),
  label: v.string(),
  sectionName: v.union(v.string(), v.null()),
  customerName: v.union(v.string(), v.null()),
  assignedStaffName: v.union(v.string(), v.null()),
  closedAt: v.number(),
  totalCents: v.number(),
  discountCents: v.number(),
  paidCents: v.number(),
  tipCents: v.number(),
  methods: v.array(paymentMethod),
  canReopen: v.boolean(),
});

const soldOutDishValidator = v.object({
  _id: v.id("dishes"),
  name: v.string(),
  categoryName: v.string(),
  priceCents: v.number(),
  isAvailable: v.boolean(),
  autoSoldOutByInventory: v.boolean(),
  soldOut: v.boolean(),
});

export const snapshot = query({
  args: {},
  returns: v.object({
    restaurantName: v.string(),
    locationName: v.string(),
    currencyCode: v.string(),
    staffId: v.id("staff"),
    staffName: v.string(),
    canReopen: v.boolean(),
    activeShift: v.union(activeShiftValidator, v.null()),
    pastShifts: v.array(pastShiftValidator),
    readyAccounts: v.array(chargeableAccountValidator),
    openAccounts: v.array(chargeableAccountValidator),
    closedAccounts: v.array(closedAccountValidator),
    dishes: v.array(soldOutDishValidator),
  }),
  handler: async (ctx) => {
    const staff = await cashierStaff(ctx);
    const canReopen = staff.roles.includes("owner") || staff.roles.includes("manager");

    const [
      restaurant,
      location,
      staffRows,
      shifts,
      awaitingAccs,
      openAccs,
      closedAccs,
      categories,
      dishes,
      balances,
    ] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
      ctx.db
        .query("staff")
        .withIndex("by_locationId_and_isActive", (q) => q.eq("locationId", staff.locationId))
        .take(100),
      ctx.db
        .query("cashShifts")
        .withIndex("by_locationId_and_openedAt", (q) => q.eq("locationId", staff.locationId))
        .order("desc")
        .take(20),
      ctx.db
        .query("accounts")
        .withIndex("by_locationId_and_state", (q) =>
          q.eq("locationId", staff.locationId).eq("state", "awaiting_payment"),
        )
        .take(80),
      ctx.db
        .query("accounts")
        .withIndex("by_locationId_and_state", (q) =>
          q.eq("locationId", staff.locationId).eq("state", "open"),
        )
        .take(80),
      ctx.db
        .query("accounts")
        .withIndex("by_locationId_and_state", (q) =>
          q.eq("locationId", staff.locationId).eq("state", "closed"),
        )
        .order("desc")
        .take(50),
      ctx.db
        .query("dishCategories")
        .withIndex("by_organizationId_and_sortOrder", (q) => q.eq("organizationId", staff.organizationId))
        .take(100),
      ctx.db
        .query("dishes")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", staff.organizationId))
        .take(200),
      ctx.db
        .query("inventoryBalances")
        .withIndex("by_locationId_and_inventoryItemId", (q) => q.eq("locationId", staff.locationId))
        .take(200),
    ]);

    const staffNames = new Map(staffRows.map((s) => [s._id, s.displayName] as const));

    const openShiftDoc = shifts.find((s) => s.closedAt === undefined) ?? null;
    let activeShift = null;
    if (openShiftDoc) {
      const stats = await computeShiftStats(ctx, openShiftDoc, staffNames);
      activeShift = {
        _id: openShiftDoc._id,
        cashierName: staffNames.get(openShiftDoc.cashierStaffId) ?? "Caja",
        openedAt: openShiftDoc.openedAt,
        fundCents: openShiftDoc.fundCents,
        expectedCashCents: stats.expectedCashCents,
        salesCents: stats.salesCents,
        tipsCents: stats.tipsCents,
        cashTipsCents: stats.cashTipsCents,
        insCents: stats.insCents,
        outsCents: stats.outsCents,
        paymentCount: stats.paymentCount,
        byMethod: stats.byMethod,
        movements: stats.movements,
      };
    }

    const closedShiftDocs = shifts.filter((s) => s.closedAt !== undefined).slice(0, 15);
    const pastShifts = await Promise.all(
      closedShiftDocs.map(async (shift) => {
        const stats = await computeShiftStats(ctx, shift, staffNames);
        const expected = shift.expectedCashCents ?? stats.expectedCashCents;
        const counted = shift.countedCashCents ?? expected;
        return {
          _id: shift._id,
          cashierName: staffNames.get(shift.cashierStaffId) ?? "Caja",
          closedByName: shift.closedByStaffId
            ? staffNames.get(shift.closedByStaffId) ?? "Caja"
            : staffNames.get(shift.cashierStaffId) ?? "Caja",
          openedAt: shift.openedAt,
          closedAt: shift.closedAt!,
          fundCents: shift.fundCents,
          expectedCashCents: expected,
          countedCashCents: counted,
          diffCents: counted - expected,
          salesCents: stats.salesCents,
          tipsCents: stats.tipsCents,
          insCents: stats.insCents,
          outsCents: stats.outsCents,
          paymentCount: stats.paymentCount,
          byMethod: stats.byMethod,
        };
      }),
    );

    async function hydrateChargeable(acc: Doc<"accounts">) {
      const [display, gross, pay] = await Promise.all([
        accountDisplayLabel(ctx, acc),
        loadAccountGrossCents(ctx, acc),
        loadAccountPaymentTotals(ctx, acc._id),
      ]);
      const discountCents = acc.discountCents ?? 0;
      const balanceCents = Math.max(0, acc.totalCents - pay.paidCents);
      return {
        _id: acc._id,
        folio: acc.folio,
        kind: acc.kind,
        state: acc.state,
        label: display.label,
        sectionName: display.sectionName,
        customerName: acc.customerName ?? null,
        assignedStaffName: acc.assignedStaffId
          ? staffNames.get(acc.assignedStaffId) ?? null
          : null,
        openedAt: acc._creationTime,
        billRequestedAt: acc.billRequestedAt ?? null,
        totalCents: acc.totalCents,
        discountKind: acc.discountKind ?? null,
        discountValue: acc.discountValue ?? null,
        discountCents,
        discountReason: acc.discountReason ?? null,
        paidCents: pay.paidCents,
        tipCents: pay.tipCents,
        balanceCents,
        itemCount: gross.activeUnits,
        buffetGuestCount: acc.buffetAdmission ? acc.buffetAdmission.adults + acc.buffetAdmission.children : 0,
        hasUndelivered: gross.hasUndelivered,
        paymentsCount: pay.confirmedCount,
        reportedPayment: hydrateReportedPayment(acc, staffNames),
      };
    }

    const readyAccounts = (await Promise.all(awaitingAccs.map(hydrateChargeable))).sort((a, b) => {
      const aReported = a.reportedPayment ? 0 : 1;
      const bReported = b.reportedPayment ? 0 : 1;
      if (aReported !== bReported) return aReported - bReported;
      if (a.reportedPayment && b.reportedPayment) {
        return a.reportedPayment.reportedAt - b.reportedPayment.reportedAt;
      }
      return (a.billRequestedAt ?? a.openedAt) - (b.billRequestedAt ?? b.openedAt);
    });

    const openWithItems = (await Promise.all(openAccs.map(hydrateChargeable)))
      .filter((a) => a.itemCount > 0 || a.buffetGuestCount > 0 || a.totalCents > 0)
      .sort((a, b) => a.openedAt - b.openedAt);

    const closedAccounts = (
      await Promise.all(
        closedAccs.map(async (acc) => {
          const [display, pay] = await Promise.all([
            accountDisplayLabel(ctx, acc),
            loadAccountPaymentTotals(ctx, acc._id),
          ]);
          return {
            _id: acc._id,
            folio: acc.folio,
            kind: acc.kind,
            label: display.label,
            sectionName: display.sectionName,
            customerName: acc.customerName ?? null,
            assignedStaffName: acc.assignedStaffId
              ? staffNames.get(acc.assignedStaffId) ?? null
              : null,
            closedAt: acc.closedAt ?? acc.updatedAt,
            totalCents: acc.totalCents,
            discountCents: acc.discountCents ?? 0,
            paidCents: pay.paidCents,
            tipCents: pay.tipCents,
            methods: pay.methods,
            canReopen,
          };
        }),
      )
    ).sort((a, b) => b.closedAt - a.closedAt);

    const autoSoldOut = location?.autoSoldOut ?? true;
    const balanceMap = new Map(balances.map((b) => [b.inventoryItemId, b.quantityMicros] as const));
    const categoryNames = new Map(categories.map((c) => [c._id, c.name] as const));
    const activeCategoryIds = new Set(categories.filter((c) => c.isActive).map((c) => c._id));

    const dishViews = (
      await Promise.all(
        dishes
          .filter((d) => (d.isPublished ?? true) && (!d.categoryId || activeCategoryIds.has(d.categoryId)))
          .map(async (dish) => {
            let autoSoldOutByInventory = false;
            if (autoSoldOut) {
              const recipe = await ctx.db
                .query("recipeIngredients")
                .withIndex("by_dishId_and_inventoryItemId", (q) => q.eq("dishId", dish._id))
                .take(50);
              autoSoldOutByInventory = recipe.some(
                (row) => (balanceMap.get(row.inventoryItemId) ?? 0) <= 0,
              );
            }
            return {
              _id: dish._id,
              name: dish.name,
              categoryName: dish.categoryId ? categoryNames.get(dish.categoryId) ?? "Sin categoría" : "Sin categoría",
              priceCents: dish.priceCents,
              isAvailable: dish.isAvailable,
              autoSoldOutByInventory,
              soldOut: !dish.isAvailable || autoSoldOutByInventory,
            };
          }),
      )
    ).sort((a, b) => a.name.localeCompare(b.name, "es-MX"));

    return {
      restaurantName: restaurant?.name ?? "Tu restaurante",
      locationName: location?.name ?? "Sucursal principal",
      currencyCode: restaurant?.currencyCode ?? "MXN",
      staffId: staff._id,
      staffName: staff.displayName,
      canReopen,
      activeShift,
      pastShifts,
      readyAccounts,
      openAccounts: openWithItems,
      closedAccounts,
      dishes: dishViews,
    };
  },
});

export const openShift = mutation({
  args: {
    fundCents: v.number(),
  },
  returns: v.id("cashShifts"),
  handler: async (ctx, args) => {
    const staff = await cashierStaff(ctx);
    const existing = await findOpenShift(ctx, staff.locationId);
    if (existing) {
      throw new ConvexError("Ya hay un turno de caja abierto en esta sucursal.");
    }
    const fundCents = safeInteger(args.fundCents, "Fondo inicial", 0);
    if (fundCents > 50_000_000) {
      throw new ConvexError("El fondo inicial excede el límite permitido.");
    }
    return await ctx.db.insert("cashShifts", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      cashierStaffId: staff._id,
      openedAt: Date.now(),
      fundCents,
    });
  },
});

export const recordCashMovement = mutation({
  args: {
    kind: cashMovementKind,
    amountCents: v.number(),
    reason: v.string(),
  },
  returns: v.id("cashShiftMovements"),
  handler: async (ctx, args) => {
    const staff = await cashierStaff(ctx);
    const shift = await findOpenShift(ctx, staff.locationId);
    if (!shift) {
      throw new ConvexError("Abre un turno de caja antes de registrar movimientos de efectivo.");
    }
    const amountCents = safeInteger(args.amountCents, "Monto", 1);
    if (amountCents > 50_000_000) {
      throw new ConvexError("El monto excede el límite permitido.");
    }
    const reason = requiredText(args.reason, "Motivo", 160);
    return await ctx.db.insert("cashShiftMovements", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      shiftId: shift._id,
      kind: args.kind,
      amountCents,
      reason,
      createdByStaffId: staff._id,
      createdAt: Date.now(),
    });
  },
});

export const closeShift = mutation({
  args: {
    countedCashCents: v.number(),
  },
  returns: v.object({
    shiftId: v.id("cashShifts"),
    expectedCashCents: v.number(),
    countedCashCents: v.number(),
    diffCents: v.number(),
    salesCents: v.number(),
    tipsCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const staff = await cashierStaff(ctx);
    const shift = await findOpenShift(ctx, staff.locationId);
    if (!shift) {
      throw new ConvexError("No hay un turno de caja abierto para cerrar.");
    }
    const countedCashCents = safeInteger(args.countedCashCents, "Efectivo contado", 0);
    if (countedCashCents > 50_000_000) {
      throw new ConvexError("El monto contado excede el límite permitido.");
    }
    const stats = await computeShiftStats(ctx, shift);
    const now = Date.now();
    await ctx.db.patch("cashShifts", shift._id, {
      closedAt: now,
      countedCashCents,
      expectedCashCents: stats.expectedCashCents,
      closedByStaffId: staff._id,
    });

    const diffCents = countedCashCents - stats.expectedCashCents;
    const location = await ctx.db.get("locations", staff.locationId);
    if (location?.autoDailySummary ?? true) {
      const diffLabel =
        diffCents === 0
          ? "Cuadra exacto"
          : diffCents > 0
            ? `Sobra ${(diffCents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}`
            : `Falta ${(Math.abs(diffCents) / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}`;
      const salesText = (stats.salesCents / 100).toLocaleString("es-MX", {
        style: "currency",
        currency: "MXN",
      });
      await emitNotification(ctx, {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        kind: "info",
        title: `Corte de caja cerrado por ${staff.displayName}`,
        body: `Ventas del turno: ${salesText} · ${diffLabel}.`,
        targetRoles: ["owner", "manager"],
        href: "/cuenta/caja",
        actionLabel: "Ver corte",
      });
    }

    return {
      shiftId: shift._id,
      expectedCashCents: stats.expectedCashCents,
      countedCashCents,
      diffCents,
      salesCents: stats.salesCents,
      tipsCents: stats.tipsCents,
    };
  },
});

export const chargeAccount = mutation({
  args: {
    accountId: v.id("accounts"),
    payments: v.array(
      v.object({
        method: paymentMethod,
        receivedCents: v.number(),
        terminalFolio: v.optional(v.string()),
      }),
    ),
    tipCents: v.optional(v.number()),
  },
  returns: v.object({
    closed: v.boolean(),
    folio: v.number(),
    paidNowCents: v.number(),
    tipNowCents: v.number(),
    changeCents: v.number(),
    remainingBalanceCents: v.number(),
    attachedToShift: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const staff = await cashierStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("Esta cuenta ya fue cerrada.");
    }

    const [{ activeItemCount }, payTotals, activeShift] = await Promise.all([
      loadAccountGrossCents(ctx, account),
      loadAccountPaymentTotals(ctx, account._id),
      findOpenShift(ctx, staff.locationId),
    ]);

    if (activeItemCount === 0 && !account.buffetAdmission) {
      throw new ConvexError("Esta cuenta no tiene productos para cobrar.");
    }

    const balanceCents = Math.max(0, account.totalCents - payTotals.paidCents);
    const tipCents = safeInteger(args.tipCents ?? 0, "Propina", 0);
    if (tipCents > 50_000_000) {
      throw new ConvexError("La propina excede el límite permitido.");
    }

    const now = Date.now();

    // 100% courtesy account (total === 0 with discount applied) can close without payment lines.
    if (balanceCents === 0) {
      if (account.totalCents === 0 && ((account.discountCents ?? 0) > 0 || account.buffetAdmission) && tipCents === 0) {
        await closeAccountAndFreeTable(ctx, account, staff, now);
        return {
          closed: true,
          folio: account.folio,
          paidNowCents: 0,
          tipNowCents: 0,
          changeCents: 0,
          remainingBalanceCents: 0,
          attachedToShift: Boolean(activeShift),
        };
      }
      throw new ConvexError("Esta cuenta ya está cubierta.");
    }

    if (args.payments.length < 1 || args.payments.length > 8) {
      throw new ConvexError("Agrega entre 1 y 8 líneas de pago.");
    }

    const validatedRows = args.payments.map((row) => {
      const receivedCents = safeInteger(row.receivedCents, "Monto recibido", 1);
      if (receivedCents > 50_000_000) {
        throw new ConvexError("El monto recibido excede el límite permitido.");
      }
      const terminalFolio = row.terminalFolio?.trim().slice(0, 40) || undefined;
      return { method: row.method as PaymentMethod, receivedCents, terminalFolio };
    });

    const totalReceived = validatedRows.reduce((sum, r) => sum + r.receivedCents, 0);
    if (totalReceived < tipCents) {
      throw new ConvexError("El monto recibido no alcanza a cubrir la propina indicada.");
    }

    const nonCashReceived = validatedRows
      .filter((r) => r.method !== "efectivo")
      .reduce((sum, r) => sum + r.receivedCents, 0);
    if (nonCashReceived > balanceCents + tipCents) {
      throw new ConvexError(
        "El monto en tarjeta, transferencia o vales no puede ser mayor al total más la propina.",
      );
    }

    // Apply non-cash rows first so cash cleanly covers any remaining tip and yields change.
    const orderedRows = [
      ...validatedRows.filter((r) => r.method !== "efectivo"),
      ...validatedRows.filter((r) => r.method === "efectivo"),
    ];

    let billLeft = balanceCents;
    let tipLeft = tipCents;
    let paidNowCents = 0;
    let tipNowCents = 0;
    let changeCents = 0;

    for (const row of orderedRows) {
      const toBill = Math.min(row.receivedCents, billLeft);
      const afterBill = row.receivedCents - toBill;
      const toTip = Math.min(afterBill, tipLeft);
      const change = afterBill - toTip;

      if (change > 0 && row.method !== "efectivo") {
        throw new ConvexError("Solo los pagos en efectivo pueden generar cambio.");
      }

      billLeft -= toBill;
      tipLeft -= toTip;
      paidNowCents += toBill;
      tipNowCents += toTip;
      changeCents += change;

      await ctx.db.insert("payments", {
        organizationId: staff.organizationId,
        locationId: staff.locationId,
        accountId: account._id,
        shiftId: activeShift?._id,
        method: row.method,
        amountCents: toBill,
        tipCents: toTip,
        receivedCents: row.receivedCents,
        changeCents: change,
        terminalFolio: row.method === "tarjeta" ? row.terminalFolio : undefined,
        status: "confirmed",
        createdByStaffId: staff._id,
        createdAt: now,
      });
    }

    const nextPaidCents = payTotals.paidCents + paidNowCents;
    const nextTipCents = payTotals.tipCents + tipNowCents;
    await ctx.db.patch("accounts", account._id, {
      paidCents: nextPaidCents,
      tipCents: nextTipCents,
      reportedPayment: undefined,
      updatedAt: now,
    });

    const closed = billLeft === 0;
    if (closed) {
      await closeAccountAndFreeTable(ctx, account, staff, now);
    }

    return {
      closed,
      folio: account.folio,
      paidNowCents,
      tipNowCents,
      changeCents,
      remainingBalanceCents: billLeft,
      attachedToShift: Boolean(activeShift),
    };
  },
});

export const applyDiscount = mutation({
  args: {
    accountId: v.id("accounts"),
    kind: v.union(v.literal("pct"), v.literal("amt"), v.literal("none")),
    value: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    discountCents: v.number(),
    totalCents: v.number(),
    balanceCents: v.number(),
  }),
  handler: async (ctx, args) => {
    const staff = await cashierStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state === "closed" || account.state === "voided") {
      throw new ConvexError("No puedes aplicar descuentos a una cuenta cerrada.");
    }

    const [{ grossCents }, payTotals] = await Promise.all([
      loadAccountGrossCents(ctx, account),
      loadAccountPaymentTotals(ctx, account._id),
    ]);

    if (args.kind === "none") {
      await ctx.db.patch("accounts", account._id, {
        discountKind: undefined,
        discountValue: undefined,
        discountCents: 0,
        discountReason: undefined,
        discountByStaffId: undefined,
      });
      const updated = await recalculateAccountTotals(ctx, account._id);
      return {
        discountCents: updated.discountCents,
        totalCents: updated.totalCents,
        balanceCents: Math.max(0, updated.totalCents - updated.paidCents),
      };
    }

    if (grossCents <= 0) {
      throw new ConvexError("La cuenta no tiene consumo para aplicar descuento.");
    }

    const reason = requiredText(args.reason ?? "", "Motivo del descuento", 160);
    const rawValue = safeInteger(args.value ?? 0, "Descuento", 1);
    if (args.kind === "pct" && rawValue > 100) {
      throw new ConvexError("El porcentaje de descuento va de 1 a 100%.");
    }
    if (args.kind === "amt" && rawValue > grossCents) {
      throw new ConvexError("El descuento no puede superar el subtotal de la cuenta.");
    }

    const preview = computeAccountAmounts(grossCents, { kind: args.kind, value: rawValue });
    if (preview.totalCents < payTotals.paidCents) {
      throw new ConvexError(
        "El descuento dejaría el total por debajo de lo que ya se cobró en esta cuenta.",
      );
    }

    await ctx.db.patch("accounts", account._id, {
      discountKind: args.kind,
      discountValue: rawValue,
      discountCents: preview.discountCents,
      discountReason: reason,
      discountByStaffId: staff._id,
      totalCents: preview.totalCents,
      updatedAt: Date.now(),
    });

    return {
      discountCents: preview.discountCents,
      totalCents: preview.totalCents,
      balanceCents: Math.max(0, preview.totalCents - payTotals.paidCents),
    };
  },
});

export const reopenAccount = mutation({
  args: {
    accountId: v.id("accounts"),
    reason: v.string(),
  },
  returns: v.object({
    folio: v.number(),
    revertedCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const staff = await adminStaff(ctx);
    const reason = requiredText(args.reason, "Motivo de reapertura", 160);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (account.state !== "closed") {
      throw new ConvexError("Solo se pueden reabrir cuentas cerradas.");
    }

    let table: Doc<"diningTables"> | null = null;
    if (account.diningTableId) {
      table = await ctx.db.get("diningTables", account.diningTableId);
      if (table && table.currentAccountId && table.currentAccountId !== account._id) {
        const occupying = await ctx.db.get("accounts", table.currentAccountId);
        if (occupying && (occupying.state === "open" || occupying.state === "awaiting_payment")) {
          throw new ConvexError(
            `${table.tableNumber} ya tiene otra cuenta activa. No se puede reabrir esta cuenta en la misma mesa.`,
          );
        }
      }
    }

    const now = Date.now();
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .take(100);

    let revertedCount = 0;
    for (const payment of payments) {
      if (payment.status !== "confirmed") continue;
      await ctx.db.patch("payments", payment._id, {
        status: "reverted",
        revertedAt: now,
        revertedByStaffId: staff._id,
        revertReason: reason,
      });
      revertedCount += 1;
    }

    await ctx.db.patch("accounts", account._id, {
      state: "awaiting_payment",
      closedAt: undefined,
      paidCents: 0,
      tipCents: 0,
      updatedAt: now,
    });

    if (table) {
      await ctx.db.patch("diningTables", table._id, {
        currentAccountId: account._id,
        assignedStaffId: account.assignedStaffId,
        status: "payment",
      });
    }

    const label = table?.tableNumber ?? account.customerName ?? formatFolio(account.folio);
    await emitNotification(ctx, {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      kind: "bill",
      title: `Cuenta reabierta: ${label}`,
      body: `Folio ${formatFolio(account.folio)} reabierto por ${staff.displayName}. Motivo: ${reason}`,
      targetRoles: ["cashier"],
      accountId: account._id,
      href: `/cuenta/mesero/cuenta/${account._id}`,
      actionLabel: "Ver cuenta",
    });

    return { folio: account.folio, revertedCount };
  },
});

export const dismissReportedPayment = mutation({
  args: {
    accountId: v.id("accounts"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await cashierStaff(ctx);
    const account = await ctx.db.get("accounts", args.accountId);
    if (!account || account.locationId !== staff.locationId) {
      throw new ConvexError("No encontramos esta cuenta.");
    }
    if (!account.reportedPayment) {
      throw new ConvexError("Esta cuenta no tiene un pago reportado pendiente.");
    }
    const previousReporter = account.reportedPayment.reportedByStaffId;
    const reason = args.reason?.trim().slice(0, 160) || "Verifica el monto o método entregado en caja.";
    await ctx.db.patch("accounts", account._id, {
      reportedPayment: undefined,
      updatedAt: Date.now(),
    });

    const display = await accountDisplayLabel(ctx, account);
    await emitNotification(ctx, {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      kind: "bill",
      title: `Revisar pago en caja: ${display.label}`,
      body: `${staff.displayName} devolvió tu reporte de pago (${formatFolio(account.folio)}). ${reason}`,
      targetStaffId: previousReporter,
      accountId: account._id,
      href: `/cuenta/mesero/cuenta/${account._id}`,
      actionLabel: "Abrir cuenta",
    });
    return null;
  },
});

export const toggleDishSoldOut = mutation({
  args: {
    dishId: v.id("dishes"),
    isAvailable: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await cashierStaff(ctx);
    const dish = await ctx.db.get("dishes", args.dishId);
    if (!dish || dish.organizationId !== staff.organizationId) {
      throw new ConvexError("No encontramos ese platillo.");
    }
    await ctx.db.patch("dishes", dish._id, { isAvailable: args.isAvailable });
    return null;
  },
});
