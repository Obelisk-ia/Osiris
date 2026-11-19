import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrderPanel } from "@/components/restaurant/waiter/order-panel";
import { requireServiceSession } from "@/lib/service-auth";

export const metadata: Metadata = { title: "Cuenta" };

async function AccountOrderContent({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const { options, registration } = await requireServiceSession();
  const isAdmin = registration.staff.roles.some((role) => role === "owner" || role === "manager");
  const isWaiter = registration.staff.roles.includes("waiter");
  const isCashier = registration.staff.roles.includes("cashier");
  const returnHref = !isAdmin && isCashier && !isWaiter ? "/cuenta/caja" : "/cuenta/mesas";
  const preloaded = await preloadQuery(
    api.waiter.orderWorkspace,
    { accountId: accountId as Id<"accounts"> },
    options,
  );
  return <OrderPanel preloaded={preloaded} returnHref={returnHref} />;
}

export default function AccountOrderPage({ params }: { params: Promise<{ accountId: string }> }) {
  return (
    <Suspense fallback={<p role="status">Cargando cuenta…</p>}>
      <AccountOrderContent params={params} />
    </Suspense>
  );
}
