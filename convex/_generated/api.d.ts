/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as assistant from "../assistant.js";
import type * as assistantAgent from "../assistantAgent.js";
import type * as assistantData from "../assistantData.js";
import type * as assistantDocs from "../assistantDocs.js";
import type * as assistantExcel from "../assistantExcel.js";
import type * as auth from "../auth.js";
import type * as buffet from "../buffet.js";
import type * as cashier from "../cashier.js";
import type * as diner from "../diner.js";
import type * as floor from "../floor.js";
import type * as inventory from "../inventory.js";
import type * as kitchen from "../kitchen.js";
import type * as menu from "../menu.js";
import type * as model_access from "../model/access.js";
import type * as model_billing from "../model/billing.js";
import type * as model_dishes from "../model/dishes.js";
import type * as model_inventory from "../model/inventory.js";
import type * as model_notifications from "../model/notifications.js";
import type * as model_orders from "../model/orders.js";
import type * as model_validators from "../model/validators.js";
import type * as notifications from "../notifications.js";
import type * as preparation from "../preparation.js";
import type * as restaurants from "../restaurants.js";
import type * as users from "../users.js";
import type * as waiter from "../waiter.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  assistant: typeof assistant;
  assistantAgent: typeof assistantAgent;
  assistantData: typeof assistantData;
  assistantDocs: typeof assistantDocs;
  assistantExcel: typeof assistantExcel;
  auth: typeof auth;
  buffet: typeof buffet;
  cashier: typeof cashier;
  diner: typeof diner;
  floor: typeof floor;
  inventory: typeof inventory;
  kitchen: typeof kitchen;
  menu: typeof menu;
  "model/access": typeof model_access;
  "model/billing": typeof model_billing;
  "model/dishes": typeof model_dishes;
  "model/inventory": typeof model_inventory;
  "model/notifications": typeof model_notifications;
  "model/orders": typeof model_orders;
  "model/validators": typeof model_validators;
  notifications: typeof notifications;
  preparation: typeof preparation;
  restaurants: typeof restaurants;
  users: typeof users;
  waiter: typeof waiter;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  auth: import("@convex-dev/auth/_generated/component.js").ComponentApi<"auth">;
  authUsername: import("@convex-dev/auth/components/username/_generated/component.js").ComponentApi<"authUsername">;
  authPassword: import("@convex-dev/auth/components/password/_generated/component.js").ComponentApi<"authPassword">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
