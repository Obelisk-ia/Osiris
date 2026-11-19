/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { authenticatedCaller, createRestaurant, setupRestaurantTest } from "../tests/convex-helpers";
import { api } from "./_generated/api";

async function setupServiceFixture() {
  const t = setupRestaurantTest();
  const { owner, code } = await createRestaurant(t);

  const waiter = await authenticatedCaller(t, "waiter@example.com");
  await waiter.mutation(api.restaurants.completeRegistration, {
    registration: { kind: "staff", displayName: "Javier", code, roles: ["waiter"] },
  });

  const cashier = await authenticatedCaller(t, "cashier@example.com");
  await cashier.mutation(api.restaurants.completeRegistration, {
    registration: { kind: "staff", displayName: "Sofía", code, roles: ["cashier"] },
  });

  const chef = await authenticatedCaller(t, "chef@example.com");
  await chef.mutation(api.restaurants.completeRegistration, {
    registration: { kind: "staff", displayName: "Marco", code, roles: ["chef"] },
  });

  const sectionId = await owner.mutation(api.floor.createSection, {
    name: "Salón",
    canvas: { x: 1, y: 1, width: 60, height: 30 },
  });
  const table1 = await owner.mutation(api.floor.createTable, {
    sectionId,
    tableNumber: "Mesa 1",
    x: 25,
    y: 50,
  });
  const table2 = await owner.mutation(api.floor.createTable, {
    sectionId,
    tableNumber: "Mesa 2",
    x: 65,
    y: 50,
  });

  const dishA = await owner.mutation(api.menu.createDish, {
    name: "Tacos de ribeye",
    priceCents: 20000,
    isAvailable: true,
    isPublished: true,
    areas: ["kitchen"],
    modifierGroupIds: [],
    recipe: [],
  });
  const dishB = await owner.mutation(api.menu.createDish, {
    name: "Agua fresca",
    priceCents: 5000,
    isAvailable: true,
    isPublished: true,
    areas: ["bar"],
    modifierGroupIds: [],
    recipe: [],
  });

  return { t, owner, waiter, cashier, chef, sectionId, table1, table2, dishA, dishB };
}

describe("cashier role, payments, shifts, discounts, and reopen", () => {
  it("blocks pure waiters from confirming payments directly and runs the report-to-cashier verification flow", async () => {
    const { owner, waiter, cashier, table1, table2, dishA } = await setupServiceFixture();

    // Order on Mesa 1 ($200) -> waiter requests bill
    const ord1 = await waiter.mutation(api.waiter.submitOrder, {
      tableId: table1,
      items: [{ dishId: dishA, quantity: 1, modifierOptionIds: [] }],
    });
    await waiter.mutation(api.waiter.requestBill, { accountId: ord1.accountId });

    // Pure waiter CANNOT close the account via confirmPayment (anti-theft control)
    await expect(
      waiter.mutation(api.waiter.confirmPayment, { accountId: ord1.accountId }),
    ).rejects.toThrow(/permiso/);

    // Waiter reports payment collected at the table -> stays open for cashier verification
    await waiter.mutation(api.waiter.reportPayment, {
      accountId: ord1.accountId,
      method: "efectivo",
      receivedCents: 25000,
      tipCents: 2000,
      note: "Billete de 200 y uno de 50",
    });

    // Mesa 1 is STILL in payment state (not freed until Caja confirms!)
    const floorPending = await owner.query(api.floor.snapshot);
    expect(floorPending.tables.find((tb) => tb._id === table1)?.status).toBe("payment");

    // Cashier receives Aviso and sees reportedPayment at top of readyAccounts
    const cashierNotifs = await cashier.query(api.notifications.list);
    expect(cashierNotifs.items.some((n) => n.title.includes("Pago reportado: Mesa 1"))).toBe(true);

    const beforeSnap = await cashier.query(api.cashier.snapshot);
    expect(beforeSnap.activeShift).toBeNull();
    expect(beforeSnap.readyAccounts).toHaveLength(1);
    expect(beforeSnap.readyAccounts[0].reportedPayment).toMatchObject({
      method: "efectivo",
      receivedCents: 25000,
      tipCents: 2000,
      reportedByName: "Javier",
      note: "Billete de 200 y uno de 50",
    });

    // Cashier can dismiss a mismatched report and waiter gets notified
    await cashier.mutation(api.cashier.dismissReportedPayment, {
      accountId: ord1.accountId,
      reason: "Faltan $50 en el efectivo entregado.",
    });
    const waiterNotifsDismiss = await waiter.query(api.notifications.list);
    expect(waiterNotifsDismiss.items.some((n) => n.title.includes("Revisar pago en caja"))).toBe(true);
    expect((await cashier.query(api.cashier.snapshot)).readyAccounts[0].reportedPayment).toBeNull();

    // Waiter re-reports -> Cashier verifies and confirms WITHOUT requiring an open shift
    await waiter.mutation(api.waiter.reportPayment, {
      accountId: ord1.accountId,
      method: "efectivo",
      receivedCents: 25000,
      tipCents: 2000,
    });
    const chargeRes = await cashier.mutation(api.cashier.chargeAccount, {
      accountId: ord1.accountId,
      payments: [{ method: "efectivo", receivedCents: 25000 }],
      tipCents: 2000,
    });
    expect(chargeRes.closed).toBe(true);
    expect(chargeRes.paidNowCents).toBe(20000);
    expect(chargeRes.tipNowCents).toBe(2000);
    expect(chargeRes.changeCents).toBe(3000);
    expect(chargeRes.attachedToShift).toBe(false);

    // Waiter received a notification that the table was closed & freed
    const waiterNotifs = await waiter.query(api.notifications.list);
    expect(waiterNotifs.items.some((n) => n.title.includes("Mesa 1: cuenta cerrada"))).toBe(true);

    // Now open a shift, take an order on Mesa 2, and have Cashier confirm payment
    await cashier.mutation(api.cashier.openShift, { fundCents: 100000 });
    const ord2 = await waiter.mutation(api.waiter.submitOrder, {
      tableId: table2,
      items: [{ dishId: dishA, quantity: 1, modifierOptionIds: [] }],
    });
    await waiter.mutation(api.waiter.requestBill, { accountId: ord2.accountId });
    await cashier.mutation(api.waiter.confirmPayment, { accountId: ord2.accountId });

    const afterSnap = await cashier.query(api.cashier.snapshot);
    expect(afterSnap.closedAccounts).toHaveLength(2);
    expect(afterSnap.activeShift?.salesCents).toBe(20000);
    expect(afterSnap.activeShift?.byMethod.efectivo).toBe(20000);
    expect(afterSnap.activeShift?.expectedCashCents).toBe(120000);
  });

  it("handles mixed payments, partial payments, tips, cash change, movements, and shift cut accurately", async () => {
    const { owner, waiter, cashier, table1, dishA, dishB } = await setupServiceFixture();

    await cashier.mutation(api.cashier.openShift, { fundCents: 150000 });
    await cashier.mutation(api.cashier.recordCashMovement, {
      kind: "ingreso",
      amountCents: 20000,
      reason: "Cambio de monedas",
    });
    await cashier.mutation(api.cashier.recordCashMovement, {
      kind: "retiro",
      amountCents: 30000,
      reason: "Pago de hielo",
    });

    // Mesa 1 total = 2 * $200 + 2 * $50 = $500 (50000 cents)
    const ord = await waiter.mutation(api.waiter.submitOrder, {
      tableId: table1,
      items: [
        { dishId: dishA, quantity: 2, modifierOptionIds: [] },
        { dishId: dishB, quantity: 2, modifierOptionIds: [] },
      ],
    });
    await waiter.mutation(api.waiter.requestBill, { accountId: ord.accountId });

    // Non-cash overpayment must be rejected
    await expect(
      cashier.mutation(api.cashier.chargeAccount, {
        accountId: ord.accountId,
        payments: [{ method: "tarjeta", receivedCents: 60000, terminalFolio: "999999" }],
        tipCents: 0,
      }),
    ).rejects.toThrow(/tarjeta, transferencia o vales/);

    // Partial payment 1: $200 by card
    const partial = await cashier.mutation(api.cashier.chargeAccount, {
      accountId: ord.accountId,
      payments: [{ method: "tarjeta", receivedCents: 20000, terminalFolio: "482910" }],
      tipCents: 0,
    });
    expect(partial.closed).toBe(false);
    expect(partial.remainingBalanceCents).toBe(30000);
    expect(partial.attachedToShift).toBe(true);

    // Table still in payment state
    const floorMid = await owner.query(api.floor.snapshot);
    expect(floorMid.tables.find((tb) => tb._id === table1)?.status).toBe("payment");

    // Payment 2 (mixed): $100 transfer + $300 cash with $50 tip -> $50 change
    const finalPay = await cashier.mutation(api.cashier.chargeAccount, {
      accountId: ord.accountId,
      payments: [
        { method: "transferencia", receivedCents: 10000 },
        { method: "efectivo", receivedCents: 30000 },
      ],
      tipCents: 5000,
    });
    expect(finalPay.closed).toBe(true);
    expect(finalPay.paidNowCents).toBe(30000);
    expect(finalPay.tipNowCents).toBe(5000);
    expect(finalPay.changeCents).toBe(5000);
    expect(finalPay.remainingBalanceCents).toBe(0);

    // Table is now empty & free
    const floorEnd = await owner.query(api.floor.snapshot);
    const t1 = floorEnd.tables.find((tb) => tb._id === table1);
    expect(t1?.status).toBe("empty");
    expect(t1?.currentAccountId).toBeUndefined();

    // Expected cash = 150000 (fund) + 20000 (cash bill) + 5000 (cash tip) + 20000 (in) - 30000 (out) = 165000
    const snapBeforeCut = await cashier.query(api.cashier.snapshot);
    expect(snapBeforeCut.activeShift?.salesCents).toBe(50000);
    expect(snapBeforeCut.activeShift?.tipsCents).toBe(5000);
    expect(snapBeforeCut.activeShift?.byMethod).toEqual({
      efectivo: 20000,
      tarjeta: 20000,
      transferencia: 10000,
      vales: 0,
    });
    expect(snapBeforeCut.activeShift?.expectedCashCents).toBe(165000);

    // Close shift with $1,640 counted (-$10 short)
    const cut = await cashier.mutation(api.cashier.closeShift, { countedCashCents: 164000 });
    expect(cut.expectedCashCents).toBe(165000);
    expect(cut.diffCents).toBe(-1000);

    const snapAfterCut = await cashier.query(api.cashier.snapshot);
    expect(snapAfterCut.activeShift).toBeNull();
    expect(snapAfterCut.pastShifts).toHaveLength(1);
    expect(snapAfterCut.pastShifts[0].diffCents).toBe(-1000);

    // Owner notified of shift cut
    const ownerNotifs = await owner.query(api.notifications.list);
    expect(ownerNotifs.items.some((n) => n.title.includes("Corte de caja cerrado"))).toBe(true);
  });

  it("supports discounts, 100% courtesies, and owner-only account reopen with table conflict guard", async () => {
    const { owner, waiter, cashier, table1, dishA } = await setupServiceFixture();

    const ord = await waiter.mutation(api.waiter.submitOrder, {
      tableId: table1,
      items: [{ dishId: dishA, quantity: 2, modifierOptionIds: [] }], // $400
    });

    // Apply 25% discount ($100 off -> $300)
    const disc = await cashier.mutation(api.cashier.applyDiscount, {
      accountId: ord.accountId,
      kind: "pct",
      value: 25,
      reason: "Cortesía de cumpleaños",
    });
    expect(disc.discountCents).toBe(10000);
    expect(disc.totalCents).toBe(30000);

    // Partial payment $250, then trying to apply $200 discount (leaving $200 < $250 paid) fails
    await cashier.mutation(api.cashier.chargeAccount, {
      accountId: ord.accountId,
      payments: [{ method: "efectivo", receivedCents: 25000 }],
    });
    await expect(
      cashier.mutation(api.cashier.applyDiscount, {
        accountId: ord.accountId,
        kind: "amt",
        value: 20000,
        reason: "Demasiado alto",
      }),
    ).rejects.toThrow(/debajo de lo que ya se cobró/);

    // Finish paying remaining $50
    await cashier.mutation(api.cashier.chargeAccount, {
      accountId: ord.accountId,
      payments: [{ method: "efectivo", receivedCents: 5000 }],
    });

    // Pure cashier cannot reopen a closed account (only owner/manager)
    await expect(
      cashier.mutation(api.cashier.reopenAccount, {
        accountId: ord.accountId,
        reason: "Error en método",
      }),
    ).rejects.toThrow();

    // Owner reopens while table is free -> payments reverted, state awaiting_payment, table payment
    const reopened = await owner.mutation(api.cashier.reopenAccount, {
      accountId: ord.accountId,
      reason: "Cliente pidió factura con tarjeta",
    });
    expect(reopened.revertedCount).toBe(2);

    const ws = await cashier.query(api.waiter.orderWorkspace, { accountId: ord.accountId });
    expect(ws.account?.state).toBe("awaiting_payment");
    expect(ws.account?.paidCents).toBe(0);
    expect(ws.account?.balanceCents).toBe(30000);
    expect(ws.account?.payments.every((p) => p.status === "reverted")).toBe(true);

    // Apply 100% courtesy and close with $0
    await cashier.mutation(api.cashier.applyDiscount, {
      accountId: ord.accountId,
      kind: "pct",
      value: 100,
      reason: "Cortesía total por gerencia",
    });
    const courtesyClose = await cashier.mutation(api.cashier.chargeAccount, {
      accountId: ord.accountId,
      payments: [],
    });
    expect(courtesyClose.closed).toBe(true);

    // Another customer sits at Mesa 1 -> owner cannot reopen the old closed account on the occupied table
    await waiter.mutation(api.waiter.submitOrder, {
      tableId: table1,
      items: [{ dishId: dishA, quantity: 1, modifierOptionIds: [] }],
    });
    await expect(
      owner.mutation(api.cashier.reopenAccount, {
        accountId: ord.accountId,
        reason: "Intentar reabrir en mesa ocupada",
      }),
    ).rejects.toThrow(/ya tiene otra cuenta activa/);
  });

  it("syncs sold-out toggles from Caja to waiter menu and enforces strict RBAC", async () => {
    const { waiter, cashier, chef, table1, dishA } = await setupServiceFixture();

    await cashier.mutation(api.cashier.toggleDishSoldOut, { dishId: dishA, isAvailable: false });
    const waiterMenu = await waiter.query(api.waiter.orderWorkspace, { tableId: table1 });
    expect(waiterMenu.dishes.find((d) => d._id === dishA)?.soldOut).toBe(true);

    await cashier.mutation(api.cashier.toggleDishSoldOut, { dishId: dishA, isAvailable: true });
    const waiterMenuAfter = await waiter.query(api.waiter.orderWorkspace, { tableId: table1 });
    expect(waiterMenuAfter.dishes.find((d) => d._id === dishA)?.soldOut).toBe(false);

    // Waiter & Chef cannot access Caja mutations/queries
    await expect(waiter.query(api.cashier.snapshot)).rejects.toThrow();
    await expect(chef.query(api.cashier.snapshot)).rejects.toThrow();
    await expect(waiter.mutation(api.cashier.openShift, { fundCents: 10000 })).rejects.toThrow();
    await expect(
      chef.mutation(api.cashier.toggleDishSoldOut, { dishId: dishA, isAvailable: false }),
    ).rejects.toThrow();
  });
});
