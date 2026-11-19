import type { Metadata } from "next";
import { fetchQuery, preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { AccountPanel } from "@/components/auth/account-panel";
import { Brand } from "@/components/brand";
import { SectionRule } from "@/components/section-rule";
import { convexAuthNextjsAccessToken, isAuthenticatedNextjs } from "@/lib/convex-auth";

export const metadata: Metadata = { title: "Mi panel" };

async function AccountContent() {
  // Protect the server render as well as the proxy and Convex data access.
  if (!(await isAuthenticatedNextjs())) redirect("/acceso");
  const token = await convexAuthNextjsAccessToken();
  const options = { token: token ?? undefined };
  const preloaded = await preloadQuery(api.users.current, {}, options);
  if (!preloadedQueryResult(preloaded)?.staffId) redirect("/crear-cuenta");

  // Owners, managers, waiters, and preparation station staff use their Atelier
  // Zero sidebar shell directly instead of the intermediate workspace hub.
  const registration = await fetchQuery(api.restaurants.current, {}, options);
  if (registration?.staff.isActive) {
    if (
      registration.staff.roles.some(
        (role) => role === "owner" || role === "manager" || role === "waiter",
      )
    ) {
      redirect("/cuenta/mesas");
    }
    if (
      registration.staff.roles.some(
        (role) =>
          role === "chef" ||
          role === "bar" ||
          role === "bartender" ||
          role === "barista",
      )
    ) {
      redirect("/cuenta/cocina");
    }
  }

  return <AccountPanel preloaded={preloaded} />;
}

export default function AccountPage() {
  return (
    <main className="site-wrap account-wrap">
      <Brand />
      <SectionRule roman="I" label="Mi panel" page="001 / 001" />
      <h1 className="editorial-title">Tu restaurante, <em>en orden</em><span className="coral-dot">.</span></h1>
      <Suspense fallback={<p role="status">Cargando tu cuenta…</p>}><AccountContent /></Suspense>
    </main>
  );
}
