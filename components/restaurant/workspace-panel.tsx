"use client";

import { usePreloadedQuery, type Preloaded } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LinkButton } from "@/components/link-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function WorkspacePanel({ preloaded }: { preloaded: Preloaded<typeof api.workspaces.snapshot> }) {
  const view = usePreloadedQuery(preloaded);
  return (
    <div className="restaurant-panel">
      <p className="restaurant-eyebrow">{view.restaurantName}</p>
      <h1 className="editorial-title">{view.title}<span className="coral-dot">.</span></h1>
      <Card className="account-card">
        <CardHeader><CardTitle>Vista inicial</CardTitle></CardHeader>
        <CardContent>
          {view.items.length ? (
            <ul className="workspace-records">
              {view.items.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.detail}</span></li>)}
            </ul>
          ) : <p>No hay registros disponibles en esta área del restaurante.</p>}
          <p className="small-note">Se muestran hasta 50 registros. La captura y las acciones de operación se habilitarán en la siguiente etapa.</p>
        </CardContent>
      </Card>
      <LinkButton href="/cuenta" variant="outline">← Cambiar de área</LinkButton>
    </div>
  );
}
