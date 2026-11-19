import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  accountState, canvas, inventoryKind, notificationKind, orderStatus, preparationArea, preparationStatus,
  staffRole, stationRole, submissionState, tableShape, tableStatus,
} from "./model/validators";

const organization = { organizationId: v.id("organizations") };
const scope = { ...organization, locationId: v.id("locations") };

export default defineSchema({
  // App profile only: credentials and login identifiers remain in Auth components.
  users: defineTable({ staffId: v.optional(v.id("staff")) }),

  organizations: defineTable({
    name: v.string(), currencyCode: v.string(), firstLocationId: v.optional(v.id("locations")),
  }),
  locations: defineTable({
    ...organization, name: v.string(), address: v.optional(v.string()), timeZone: v.string(),
    guestOrderMode: v.union(v.literal("confirmation"), v.literal("direct")),
    maxPendingGuestOrders: v.number(), restrictWaitersToAssignedTables: v.boolean(),
    serviceMode: v.union(v.literal("a_la_carte"), v.literal("buffet"), v.literal("mixed")),
    autoSoldOut: v.optional(v.boolean()),
    autoLateOrderEnabled: v.optional(v.boolean()),
    autoLateOrderMinutes: v.optional(v.number()),
    autoAtypicalEnabled: v.optional(v.boolean()),
    autoAtypicalThreshold: v.optional(v.number()),
    autoSupplierOrder: v.optional(v.boolean()),
    autoDailySummary: v.optional(v.boolean()),
    enabledPreparationAreas: v.optional(v.array(preparationArea)),
  }).index("by_organizationId", ["organizationId"]),
  staff: defineTable({
    ...scope, userId: v.id("users"), displayName: v.string(), roles: v.array(staffRole), isActive: v.boolean(),
  }).index("by_userId", ["userId"])
    .index("by_organizationId_and_userId", ["organizationId", "userId"])
    .index("by_locationId_and_isActive", ["locationId", "isActive"]),
  // No generic read endpoint. Only the restaurant owner can retrieve/rotate it.
  organizationCodes: defineTable({
    ...scope, code: v.string(), updatedAt: v.number(),
  }).index("by_code", ["code"]).index("by_organizationId", ["organizationId"]),

  dishCategories: defineTable({
    ...organization, name: v.string(), sortOrder: v.number(), isActive: v.boolean(),
  }).index("by_organizationId_and_sortOrder", ["organizationId", "sortOrder"]),
  dishes: defineTable({
    ...organization, name: v.string(), description: v.optional(v.string()), priceCents: v.number(),
    isAvailable: v.boolean(), isPublished: v.optional(v.boolean()),
    area: v.optional(v.union(v.literal("cocina"), v.literal("barra"))),
    areas: v.optional(v.array(preparationArea)),
    categoryId: v.optional(v.id("dishCategories")),
    photoId: v.optional(v.id("_storage")),
  }).index("by_organizationId", ["organizationId"]).index("by_categoryId", ["categoryId"]),
  dishIngredients: defineTable({
    ...organization, dishId: v.id("dishes"), name: v.optional(v.string()), quantityText: v.optional(v.string()),
  }).index("by_dishId", ["dishId"]),
  modifierGroups: defineTable({
    ...organization, name: v.string(), minSelections: v.number(), maxSelections: v.optional(v.number()),
    sortOrder: v.number(), isActive: v.boolean(),
  }).index("by_organizationId_and_name", ["organizationId", "name"]),
  modifierOptions: defineTable({
    ...organization, modifierGroupId: v.id("modifierGroups"), name: v.string(), priceExtraCents: v.number(),
    sortOrder: v.number(), isActive: v.boolean(),
  }).index("by_modifierGroupId_and_name", ["modifierGroupId", "name"]),
  dishModifierGroups: defineTable({
    ...organization, dishId: v.id("dishes"), modifierGroupId: v.id("modifierGroups"), sortOrder: v.number(),
  }).index("by_dishId_and_modifierGroupId", ["dishId", "modifierGroupId"])
    .index("by_modifierGroupId", ["modifierGroupId"]),

  suppliers: defineTable({
    ...organization, name: v.string(), contact: v.optional(v.string()), isActive: v.boolean(),
  }).index("by_organizationId_and_name", ["organizationId", "name"]),

  // Quantities are safe integers in millionths of g/ml/each, never floats.
  inventoryItems: defineTable({
    ...organization, name: v.string(), unit: v.union(v.literal("g"), v.literal("ml"), v.literal("each")),
    isActive: v.boolean(),
    category: v.optional(v.string()),
    minMicros: v.optional(v.number()),
    maxMicros: v.optional(v.number()),
    thresholdPct: v.optional(v.number()),
    presentation: v.optional(v.string()),
    factorMicros: v.optional(v.number()),
    supplierId: v.optional(v.id("suppliers")),
    lastCostCents: v.optional(v.number()),
  }).index("by_organizationId_and_name", ["organizationId", "name"]),
  inventoryBalances: defineTable({
    ...scope, inventoryItemId: v.id("inventoryItems"), quantityMicros: v.number(), updatedAt: v.number(),
  }).index("by_locationId_and_inventoryItemId", ["locationId", "inventoryItemId"]),
  recipeIngredients: defineTable({
    ...organization, dishId: v.id("dishes"), inventoryItemId: v.id("inventoryItems"), quantityMicros: v.number(),
  }).index("by_dishId_and_inventoryItemId", ["dishId", "inventoryItemId"])
    .index("by_inventoryItemId", ["inventoryItemId"]),
  modifierRecipeIngredients: defineTable({
    ...organization, modifierOptionId: v.id("modifierOptions"),
    inventoryItemId: v.id("inventoryItems"), quantityDeltaMicros: v.number(),
  }).index("by_modifierOptionId_and_inventoryItemId", ["modifierOptionId", "inventoryItemId"])
    .index("by_inventoryItemId", ["inventoryItemId"]),
  inventoryMovements: defineTable({
    ...scope, inventoryItemId: v.id("inventoryItems"), kind: inventoryKind, quantityDeltaMicros: v.number(),
    referenceId: v.string(), dishId: v.optional(v.id("dishes")), recipePortions: v.optional(v.number()),
    reason: v.string(), createdByStaffId: v.id("staff"),
  }).index("by_locationId_and_inventoryItemId", ["locationId", "inventoryItemId"])
    .index("by_locationId_and_referenceId_and_inventoryItemId", ["locationId", "referenceId", "inventoryItemId"])
    .index("by_locationId", ["locationId"]),

  sections: defineTable({
    ...scope, name: v.string(), description: v.optional(v.string()), sortOrder: v.number(), canvas,
  }).index("by_locationId_and_sortOrder", ["locationId", "sortOrder"]),
  tableTypes: defineTable({
    ...scope, name: v.string(), shape: tableShape, seatCount: v.number(), isActive: v.boolean(),
  }).index("by_locationId_and_name", ["locationId", "name"]),
  diningTables: defineTable({
    ...scope, sectionId: v.id("sections"), tableTypeId: v.optional(v.id("tableTypes")),
    tableNumber: v.string(), seatCount: v.number(), shape: tableShape, canvas,
    status: tableStatus,
    isActive: v.boolean(), qrToken: v.string(), qrEnabled: v.boolean(), qrCreatedAt: v.number(),
    qrVersion: v.optional(v.number()),
    assignedStaffId: v.optional(v.id("staff")), currentAccountId: v.optional(v.id("accounts")),
  }).index("by_locationId", ["locationId"])
    .index("by_locationId_and_assignedStaffId", ["locationId", "assignedStaffId"])
    .index("by_locationId_and_isActive", ["locationId", "isActive"])
    .index("by_locationId_and_assignedStaffId_and_isActive", ["locationId", "assignedStaffId", "isActive"])
    .index("by_sectionId_and_tableNumber", ["sectionId", "tableNumber"])
    .index("by_qrToken", ["qrToken"]),
  sectionAssignments: defineTable({
    ...scope, sectionId: v.id("sections"), assignedStaffId: v.id("staff"),
    assignedByStaffId: v.optional(v.id("staff")), startsAt: v.number(), endsAt: v.optional(v.number()),
  }).index("by_sectionId_and_startsAt", ["sectionId", "startsAt"]),
  preparationStations: defineTable({
    ...scope, name: v.string(), isActive: v.boolean(), responsibleStaffId: v.optional(v.id("staff")),
    role: stationRole,
    area: v.optional(preparationArea),
  }).index("by_locationId_and_name", ["locationId", "name"]),
  dishStations: defineTable({
    ...scope, dishId: v.id("dishes"), stationId: v.id("preparationStations"),
  }).index("by_dishId_and_stationId", ["dishId", "stationId"]),

  accounts: defineTable({
    ...scope, sectionId: v.optional(v.id("sections")), diningTableId: v.optional(v.id("diningTables")),
    assignedStaffId: v.optional(v.id("staff")), openedByStaffId: v.id("staff"),
    kind: v.union(v.literal("dine_in"), v.literal("counter"), v.literal("takeaway"), v.literal("pickup")),
    state: accountState, folio: v.number(), version: v.number(), requestId: v.string(), totalCents: v.number(),
    customerName: v.optional(v.string()), customerPhone: v.optional(v.string()),
    phoneConsentAt: v.optional(v.number()), privacyNoticeVersion: v.optional(v.string()),
    promisedAt: v.optional(v.number()), billRequestedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()), updatedAt: v.number(),
  }).index("by_locationId_and_state", ["locationId", "state"])
    .index("by_locationId_and_folio", ["locationId", "folio"])
    .index("by_locationId_and_requestId", ["locationId", "requestId"])
    .index("by_diningTableId_and_state", ["diningTableId", "state"]),
  accountFolioCounters: defineTable({
    ...scope, nextFolio: v.number(), updatedAt: v.number(),
  }).index("by_locationId", ["locationId"]),
  accountAssignments: defineTable({
    ...scope, accountId: v.id("accounts"), previousStaffId: v.optional(v.id("staff")),
    assignedStaffId: v.id("staff"), changedByStaffId: v.id("staff"), reason: v.optional(v.string()),
  }).index("by_accountId", ["accountId"]),
  // Orders always belong to a service account; a physical table is optional.
  orders: defineTable({
    ...scope, accountId: v.id("accounts"), diningTableId: v.optional(v.id("diningTables")),
    status: orderStatus, comments: v.optional(v.string()), takenByStaffId: v.id("staff"), updatedAt: v.number(),
  }).index("by_accountId", ["accountId"]).index("by_locationId_and_status", ["locationId", "status"]),
  orderItems: defineTable({
    ...scope, orderId: v.id("orders"), dishId: v.id("dishes"), quantity: v.number(),
    unitPriceCents: v.number(), dishName: v.string(), comments: v.optional(v.string()),
    status: orderStatus, updatedAt: v.number(), guestOrderItemId: v.optional(v.id("guestOrderItems")),
    inventoryConsumedAt: v.optional(v.number()),
    inventoryConsumedQuantity: v.optional(v.number()),
    deliveredQuantity: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelledByStaffId: v.optional(v.id("staff")),
    cancelReason: v.optional(v.string()),
    cancelInventoryAction: v.optional(v.union(v.literal("none"), v.literal("return"), v.literal("waste"))),
  }).index("by_orderId", ["orderId"]).index("by_guestOrderItemId", ["guestOrderItemId"]),
  orderItemPreparations: defineTable({
    ...scope, orderItemId: v.id("orderItems"), stationId: v.id("preparationStations"),
    status: preparationStatus, updatedAt: v.number(), startedAt: v.optional(v.number()),
    startedByStaffId: v.optional(v.id("staff")),
    startedQuantity: v.optional(v.number()),
    readyQuantity: v.optional(v.number()),
    readyAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    deliveredByStaffId: v.optional(v.id("staff")),
    cancelAcknowledgedAt: v.optional(v.number()),
  }).index("by_orderItemId_and_stationId", ["orderItemId", "stationId"])
    .index("by_locationId_and_status", ["locationId", "status"]),
  orderItemModifiers: defineTable({
    ...scope, orderItemId: v.id("orderItems"), dishId: v.id("dishes"),
    modifierOptionId: v.optional(v.id("modifierOptions")), groupName: v.string(),
    optionName: v.string(), quantity: v.number(), unitPriceExtraCents: v.number(),
    // Recipe deltas are snapshotted so deleting/changing a modifier cannot alter an order.
    recipeDeltas: v.array(v.object({ inventoryItemId: v.id("inventoryItems"), quantityDeltaMicros: v.number() })),
  }).index("by_orderItemId", ["orderItemId"]),

  buffetMenus: defineTable({
    ...scope, menuDate: v.string(), name: v.string(), isActive: v.boolean(),
  }).index("by_locationId_and_menuDate", ["locationId", "menuDate"])
    .index("by_locationId_and_isActive_and_menuDate", ["locationId", "isActive", "menuDate"]),
  buffetMenuDishes: defineTable({
    ...scope, buffetMenuId: v.id("buffetMenus"), dishId: v.id("dishes"), sortOrder: v.number(),
  }).index("by_buffetMenuId_and_dishId", ["buffetMenuId", "dishId"]),
  buffetDiners: defineTable({
    ...scope, diningTableId: v.id("diningTables"), accountId: v.id("accounts"),
    seatedAt: v.number(), finishedAt: v.optional(v.number()), isActive: v.boolean(),
  }).index("by_accountId_and_isActive", ["accountId", "isActive"]),
  buffetServings: defineTable({
    ...scope, diningTableId: v.id("diningTables"), dinerId: v.optional(v.id("buffetDiners")),
    dishId: v.id("dishes"), stationId: v.optional(v.id("preparationStations")),
    batchId: v.optional(v.id("buffetBatches")),
    status: v.union(v.literal("served"), v.literal("finished")), servedAt: v.number(), finishedAt: v.optional(v.number()),
  }).index("by_locationId_and_status", ["locationId", "status"])
    .index("by_dinerId", ["dinerId"]),
  // Buffet stock is consumed per preparation batch, NOT again per diner/serving.
  buffetBatches: defineTable({
    ...scope, buffetMenuId: v.id("buffetMenus"), dishId: v.id("dishes"),
    stationId: v.id("preparationStations"), portions: v.number(), status: preparationStatus,
    inventoryConsumedAt: v.optional(v.number()), startedByStaffId: v.optional(v.id("staff")), updatedAt: v.number(),
  }).index("by_locationId_and_status", ["locationId", "status"]),

  // QR access remains separate from staff/auth sessions; not publicly exposed yet.
  guestSessions: defineTable({
    ...scope, accountId: v.id("accounts"), tokenHash: v.string(), nickname: v.optional(v.string()),
    expiresAt: v.number(), revokedAt: v.optional(v.number()),
  }).index("by_tokenHash", ["tokenHash"]).index("by_accountId", ["accountId"]),
  guestOrderSubmissions: defineTable({
    ...scope, accountId: v.id("accounts"), guestSessionId: v.id("guestSessions"), requestId: v.string(),
    requestFingerprint: v.optional(v.string()), state: submissionState, version: v.number(),
    reviewedByStaffId: v.optional(v.id("staff")), reviewedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
  }).index("by_locationId_and_requestId", ["locationId", "requestId"])
    .index("by_locationId_and_state", ["locationId", "state"]),
  guestOrderItems: defineTable({
    ...scope, submissionId: v.id("guestOrderSubmissions"), dishId: v.id("dishes"),
    dishName: v.string(), quantity: v.number(), unitPriceCents: v.number(), comments: v.optional(v.string()),
  }).index("by_submissionId", ["submissionId"]),
  guestOrderItemModifiers: defineTable({
    ...scope, guestOrderItemId: v.id("guestOrderItems"), modifierOptionId: v.optional(v.id("modifierOptions")),
    groupName: v.string(), optionName: v.string(), quantity: v.number(), unitPriceExtraCents: v.number(),
  }).index("by_guestOrderItemId", ["guestOrderItemId"]),
  serviceRequests: defineTable({
    ...scope, accountId: v.id("accounts"), guestSessionId: v.optional(v.id("guestSessions")),
    kind: v.union(v.literal("call_waiter"), v.literal("request_bill"), v.literal("collect_payment")),
    state: v.union(v.literal("pending"), v.literal("acknowledged"), v.literal("resolved"), v.literal("cancelled")),
    requestId: v.string(), acknowledgedByStaffId: v.optional(v.id("staff")),
    acknowledgedAt: v.optional(v.number()), resolvedAt: v.optional(v.number()),
  }).index("by_locationId_and_state", ["locationId", "state"])
    .index("by_locationId_and_requestId", ["locationId", "requestId"]),

  notifications: defineTable({
    ...scope,
    kind: notificationKind,
    title: v.string(),
    body: v.string(),
    targetStaffId: v.optional(v.id("staff")),
    targetRoles: v.array(staffRole),
    accountId: v.optional(v.id("accounts")),
    href: v.optional(v.string()),
    actionLabel: v.optional(v.string()),
    readByStaffIds: v.array(v.id("staff")),
    createdAt: v.number(),
  }).index("by_locationId_and_createdAt", ["locationId", "createdAt"]),
});
