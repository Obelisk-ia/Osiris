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
  const { options } = await requireServiceSession();
  const preloaded = await preloadQuery(
    api.waiter.orderWorkspace,
    { accountId: accountId as Id<"accounts"> },
    options,
  );
  return <OrderPanel preloaded={preloaded} returnHref="/cuenta/mesas" />;
}

export default function AccountOrderPage({ params }: { params: Promise<{ accountId: string }> }) {
  return (
    <Suspense fallback={<p role="status">Cargando cuenta…</p>}>
      <AccountOrderContent params={params} />
    </Suspense>
  );
}
