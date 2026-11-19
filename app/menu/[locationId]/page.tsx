import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { PublicMenuView } from "@/components/restaurant/diner/diner-menu-view";

export const metadata: Metadata = { title: "La carta" };

async function PublicMenuContent({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params;
  const preloaded = await preloadQuery(api.diner.publicMenu, { locationId });
  return <PublicMenuView preloaded={preloaded} />;
}

export default function PublicMenuPage({ params }: { params: Promise<{ locationId: string }> }) {
  return (
    <Suspense fallback={<div className="page-loading" role="status">Cargando la carta…</div>}>
      <PublicMenuContent params={params} />
    </Suspense>
  );
}
