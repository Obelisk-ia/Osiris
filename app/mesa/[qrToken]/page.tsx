import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { DinerTableView } from "@/components/restaurant/diner/diner-menu-view";

export const metadata: Metadata = { title: "Carta y mesa" };

async function DinerTableContent({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params;
  const preloaded = await preloadQuery(api.diner.tableByQrToken, { qrToken });
  return <DinerTableView qrToken={qrToken} preloaded={preloaded} />;
}

export default function DinerTablePage({ params }: { params: Promise<{ qrToken: string }> }) {
  return (
    <Suspense fallback={<div className="page-loading" role="status">Cargando la carta…</div>}>
      <DinerTableContent params={params} />
    </Suspense>
  );
}
