import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrderPanel } from "@/components/restaurant/waiter/order-panel";
import { requireServiceSession } from "@/lib/service-auth";

export const metadata: Metadata = { title: "Tomar orden" };

async function TableOrderContent({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const { options } = await requireServiceSession();
  const preloaded = await preloadQuery(
    api.waiter.orderWorkspace,
    { tableId: tableId as Id<"diningTables"> },
    options,
  );
  return <OrderPanel preloaded={preloaded} returnHref="/cuenta/mesas" />;
}

export default function TableOrderPage({ params }: { params: Promise<{ tableId: string }> }) {
  return (
    <Suspense fallback={<p role="status">Cargando menú y mesa…</p>}>
      <TableOrderContent params={params} />
    </Suspense>
  );
}
