import type { Metadata } from "next";
import { preloadQuery } from "convex/nextjs";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { FeaturesPanel } from "@/components/restaurant/admin/features-panel";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Características" };

async function FeaturesContent() {
  const { options } = await requireAdminSession();
  const preloaded = await preloadQuery(api.admin.featuresSnapshot, {}, options);
  return <FeaturesPanel preloaded={preloaded} />;
}

export default function FeaturesPage() {
  return (
    <Suspense fallback={<p role="status">Cargando características…</p>}>
      <FeaturesContent />
    </Suspense>
  );
}
