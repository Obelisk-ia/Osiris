/// <reference types="vite/client" />

import { registerCore, sessionIdentity } from "@convex-dev/auth/test";
import { registerUsername } from "@convex-dev/auth/components/username/test";
import { registerPassword } from "@convex-dev/auth/components/password/test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

export function setupRestaurantTest() {
  vi.stubEnv("CONVEX_CLOUD_URL", "https://some-deployment.convex.cloud");
  const t = convexTest(schema, modules);
  registerCore(t);
  registerUsername(t);
  registerPassword(t);
  rateLimiter.register(t);
  return { ...t, ...t.withRequestMetadata({ ip: "203.0.113.9", userAgent: "Osiris restaurant tests" }) };
}
export type RestaurantTest = ReturnType<typeof setupRestaurantTest>;

export async function authenticatedCaller(t: RestaurantTest, email: string) {
  const result = await t.mutation(api.auth.signUpWithUsernamePassword, {
    username: email, password: "Desert lanterns! Copper river 829",
  });
  if (result.status !== "complete") throw new Error(JSON.stringify(result));
  return t.withIdentity(sessionIdentity(result.tokens));
}

export async function createRestaurant(t: RestaurantTest, email = "owner@example.com") {
  const owner = await authenticatedCaller(t, email);
  await owner.mutation(api.restaurants.completeRegistration, {
    registration: { kind: "owner", displayName: "Mariana", restaurantName: "Casa Jacaranda" },
  });
  const registration = await owner.query(api.restaurants.current);
  if (!registration) throw new Error("Missing restaurant");
  const code = await owner.query(api.restaurants.ownerCode);
  if (!code) throw new Error("Missing restaurant code");
  return { owner, registration, code };
}
