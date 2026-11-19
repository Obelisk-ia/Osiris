import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { TakeoutPanel } from "@/components/restaurant/waiter/takeout-panel";
import { requireServiceSession } from "@/lib/service-auth";

export const metadata: Metadata = { title: "Para llevar" };

async function TakeoutContent() {
  const { options } = await requireServiceSession();
  const preloaded = await preloadQuery(api.waiter.takeoutSnapshot, {}, options);
  return <TakeoutPanel preloaded={preloaded} />;
}

export default function TakeoutPage() {
  return (
    <Suspense fallback={<p role="status">Cargando pedidos para llevar…</p>}>
      <TakeoutContent />
    </Suspense>
  );
}
