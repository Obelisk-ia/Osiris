import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { convexAuthNextjsAccessToken, isAuthenticatedNextjs } from "@/lib/convex-auth";

export async function requireServiceSession() {
  if (!(await isAuthenticatedNextjs())) redirect("/acceso");
  const token = await convexAuthNextjsAccessToken();
  const options = { token: token ?? undefined };
  const registration = await fetchQuery(api.restaurants.current, {}, options);
  if (
    !registration?.staff.isActive ||
    !registration.staff.roles.some((role) => role === "waiter" || role === "owner" || role === "manager")
  ) {
    redirect("/cuenta");
  }
  return { options, registration };
}
