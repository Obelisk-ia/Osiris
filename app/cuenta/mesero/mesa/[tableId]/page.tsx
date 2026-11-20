import type { Metadata } from "next";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrderPanel } from "@/components/restaurant/waiter/order-panel";
import { requireServiceSession } from "@/lib/service-auth";

export const metadata: Metadata = { title: "Mesa" };

async function TableOrderContent({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const { options } = await requireServiceSession();
  const preloaded = await preloadQuery(
    api.waiter.orderWorkspace,
    { tableId: tableId as Id<"diningTables"> },
    options,
  );
  const workspace = preloadedQueryResult(preloaded);
  if (!workspace.tableServiceEnabled && !workspace.account) redirect("/cuenta/buffet");
  return <OrderPanel preloaded={preloaded} returnHref="/cuenta/mesas" />;
}

export default function TableOrderPage({ params }: { params: Promise<{ tableId: string }> }) {
  return (
    <Suspense fallback={<p role="status">Cargando menú y mesa…</p>}>
      <TableOrderContent params={params} />
    </Suspense>
  );
}
