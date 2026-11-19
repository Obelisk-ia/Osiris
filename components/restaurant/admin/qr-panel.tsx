"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  EyeOff,
  Printer,
  QrCode,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/format";
import { AdminModal, AdminPageHead, ConfirmModal, EmptyState, ToastBanner, useToast } from "./admin-ui";

type Snapshot = NonNullable<ReturnType<typeof usePreloadedQuery<typeof api.floor.snapshot>>>;
type TableItem = Snapshot["tables"][number];

function buildQrSvgModel(url: string): { size: number; path: string } {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const modules = qr.modules;
  const count = modules.size;
  const margin = 2;
  let path = "";
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (modules.get(x, y)) {
        path += `M${x + margin} ${y + margin}h1v1h-1z`;
      }
    }
  }
  return { size: count + margin * 2, path };
}

function buildQrSvgMarkup(label: string, url: string): string {
  const { size, path } = buildQrSvgModel(url);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Código QR de ${label}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path fill="#15140f" d="${path}"/></svg>`;
}

function resolvePublicUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export function QrPanel({
  preloaded,
  locationId,
  locationName,
}: {
  preloaded: Preloaded<typeof api.floor.snapshot>;
  locationId: Id<"locations">;
  locationName: string;
}) {
  const data = usePreloadedQuery(preloaded);
  const { toast, showToast } = useToast();

  const regenerateQr = useMutation(api.floor.regenerateTableQr);
  const setQrEnabled = useMutation(api.floor.setTableQrEnabled);

  const [selectedId, setSelectedId] = useState<Id<"diningTables"> | null>(null);
  const [publicMenuModal, setPublicMenuModal] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState<TableItem | null>(null);
  const [pending, setPending] = useState(false);

  const sectionNames = useMemo(
    () => new Map(data.sections.map((s) => [s._id, s.name] as const)),
    [data.sections],
  );

  const selectedTable = selectedId ? data.tables.find((t) => t._id === selectedId) ?? null : null;

  const publicMenuPath = `/menu/${locationId}`;
  const publicMenuUrl = resolvePublicUrl(publicMenuPath);

  function tablePath(table: TableItem) {
    return `/mesa/${table.qrToken}`;
  }

  function tableUrl(table: TableItem) {
    return resolvePublicUrl(tablePath(table));
  }

  async function copyUrl(url: string, label: string) {
    try {
      await navigator.clipboard.writeText(url);
      showToast(`Enlace de ${label} copiado`);
    } catch {
      showToast("No pudimos copiar el enlace. Cópialo manualmente.", "err");
    }
  }

  function downloadSvg(label: string, url: string, fileSlug: string) {
    const svg = buildQrSvgMarkup(label, url);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `qr_${fileSlug}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    showToast("Código QR descargado");
  }

  function printQr(title: string, subtitle: string, url: string, footer: string) {
    const svg = buildQrSvgMarkup(title, url);
    const win = window.open("", "_blank", "width=440,height=600");
    if (!win) {
      showToast("Tu navegador bloqueó la ventana de impresión.", "err");
      return;
    }
    const doc = win.document;
    doc.open();
    doc.write(`<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><title>QR · ${title}</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:32px;color:#15140f}svg{width:260px;height:260px;margin:18px auto;display:block}h1{margin:0 0 4px;font-size:24px}p{margin:4px 0;color:#5a5448;font-size:14px}.url{font-family:monospace;font-size:11px;word-break:break-all;margin-top:12px}</style></head><body><h1>${data.restaurantName}</h1><p>${subtitle}</p>${svg}<p>${footer}</p><p class="url">${url}</p></body></html>`);
    doc.close();
    win.focus();
    win.print();
  }

  async function handleRegenerate() {
    if (!confirmRegen) return;
    setPending(true);
    try {
      const res = await regenerateQr({ tableId: confirmRegen._id });
      showToast(`Código regenerado · Versión ${res.qrVersion}`);
      setConfirmRegen(null);
    } catch (cause) {
      showToast(errorMessage(cause, "No pudimos regenerar el código."), "err");
    } finally {
      setPending(false);
    }
  }

  const publicQrModel = useMemo(
    () => (publicMenuModal ? buildQrSvgModel(publicMenuUrl) : null),
    [publicMenuModal, publicMenuUrl],
  );
  const selectedQrModel = useMemo(
    () => (selectedTable ? buildQrSvgModel(tableUrl(selectedTable)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedTable?._id, selectedTable?.qrToken],
  );

  return (
    <div className="az-page">
      <AdminPageHead
        index={6}
        total={10}
        restaurantName={data.restaurantName}
        locationName={locationName}
        title="Códigos QR"
        subtitle="Cada mesa tiene su propio código QR escaneable para consultar el menú, llamar al mesero y pedir la cuenta."
        actions={
          <Link
            href="/cuenta/mesas"
            className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:border-foreground"
          >
            Ir al plano de mesas
          </Link>
        }
      />

      <section className="az-card" aria-label="Carta pública sin mesa">
        <div className="az-row-main">
          <div className="az-row-text">
            <div className="az-cluster">
              <strong className="font-heading text-lg font-bold">Carta pública (sin mesa)</strong>
              <span className="az-badge success">
                <BookOpen aria-hidden="true" />
                Siempre activa
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Menú de solo lectura para compartir en redes, Google Maps o colocar en la entrada del
              restaurante.
            </p>
          </div>
          <div className="az-row-actions">
            <a
              href={publicMenuPath}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs font-semibold hover:border-foreground"
            >
              Abrir carta
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copyUrl(publicMenuUrl, "carta pública")}
            >
              <Copy className="size-3.5" aria-hidden="true" />
              Copiar enlace
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPublicMenuModal(true)}>
              <QrCode className="size-4" aria-hidden="true" />
              Ver QR
            </Button>
          </div>
        </div>
      </section>

      {data.tables.length > 0 ? (
        <section className="grid gap-3" aria-label="Códigos QR por mesa">
          <h2 className="font-heading text-xl font-bold tracking-tight">Códigos QR por mesa</h2>
          <ul className="az-rows">
            {data.tables.map((table) => {
              const sectionName = sectionNames.get(table.sectionId) ?? "Sección";
              const version = table.qrVersion ?? 1;
              return (
                <li key={table._id}>
                  <div className="az-row-main">
                    <div className="az-row-text">
                      <div className="az-cluster">
                        <strong>{table.tableNumber}</strong>
                        {table.qrEnabled ? (
                          <span className="az-badge success">
                            <Check aria-hidden="true" />
                            Activo
                          </span>
                        ) : (
                          <span className="az-badge">
                            <EyeOff aria-hidden="true" />
                            Pausado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {sectionName} · Versión {version} del código · {table.seatCount} pers.
                      </p>
                    </div>
                    <div className="az-row-actions">
                      <a
                        href={tablePath(table)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:border-foreground"
                      >
                        Abrir vista comensal
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                      <Button variant="outline" size="sm" onClick={() => setSelectedId(table._id)}>
                        <QrCode className="size-4" aria-hidden="true" />
                        Ver código
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <EmptyState
          icon={<QrCode className="size-7" aria-hidden="true" />}
          title="Todavía no hay mesas"
          description="Cuando agregues mesas en tu plano, cada una generará automáticamente su código QR aquí."
          action={
            <Link
              href="/cuenta/mesas"
              className="inline-flex items-center justify-center rounded-full bg-foreground text-card px-5 py-2.5 text-sm font-semibold mt-2"
            >
              Configurar plano de mesas
            </Link>
          }
        />
      )}

      {publicMenuModal && publicQrModel && (
        <AdminModal title="QR · Carta pública" onClose={() => setPublicMenuModal(false)}>
          <div className="az-qr-box">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox={`0 0 ${publicQrModel.size} ${publicQrModel.size}`}
              role="img"
              aria-label={`Código QR de la carta pública de ${data.restaurantName}`}
              shapeRendering="crispEdges"
            >
              <rect width={publicQrModel.size} height={publicQrModel.size} fill="#ffffff" />
              <path fill="#15140f" d={publicQrModel.path} />
            </svg>
          </div>
          <p className="text-xs font-mono text-muted-foreground break-all text-center">
            {publicMenuUrl}
          </p>
          <div className="grid gap-2">
            <a
              href={publicMenuPath}
              target="_blank"
              rel="noreferrer"
              className="site-button inline-flex items-center justify-center bg-foreground text-card"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Abrir carta pública
            </a>
            <Button variant="outline" onClick={() => void copyUrl(publicMenuUrl, "carta pública")}>
              <Copy className="size-4" aria-hidden="true" />
              Copiar enlace
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadSvg("carta pública", publicMenuUrl, "carta_publica")}
            >
              <Download className="size-4" aria-hidden="true" />
              Descargar SVG
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                printQr(
                  "Carta pública",
                  `${locationName} · Menú digital`,
                  publicMenuUrl,
                  "Escanea para consultar nuestra carta",
                )
              }
            >
              <Printer className="size-4" aria-hidden="true" />
              Imprimir código
            </Button>
          </div>
        </AdminModal>
      )}

      {selectedTable && selectedQrModel && (
        <AdminModal title={`Código QR de ${selectedTable.tableNumber}`} onClose={() => setSelectedId(null)}>
          <div className="az-qr-box">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox={`0 0 ${selectedQrModel.size} ${selectedQrModel.size}`}
              role="img"
              aria-label={`Código QR de ${selectedTable.tableNumber}`}
              shapeRendering="crispEdges"
            >
              <rect width={selectedQrModel.size} height={selectedQrModel.size} fill="#ffffff" />
              <path fill="#15140f" d={selectedQrModel.path} />
            </svg>
          </div>

          <p className="text-xs font-mono text-muted-foreground break-all text-center">
            {tableUrl(selectedTable)}
          </p>

          <p className="text-sm text-muted-foreground">
            <strong>Versión {selectedTable.qrVersion ?? 1}.</strong> Al escanear este código, el
            comensal ve la carta en vivo, puede llamar al mesero y pedir la cuenta cuando ya recibió
            todos sus platillos. Regenerarlo invalida inmediatamente el anterior.
          </p>

          <div className="grid gap-2">
            <a
              href={tablePath(selectedTable)}
              target="_blank"
              rel="noreferrer"
              className="site-button inline-flex items-center justify-center bg-foreground text-card"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Abrir vista del comensal
            </a>
            <Button
              variant="outline"
              onClick={() => void copyUrl(tableUrl(selectedTable), selectedTable.tableNumber)}
            >
              <Copy className="size-4" aria-hidden="true" />
              Copiar enlace
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadSvg(
                  selectedTable.tableNumber,
                  tableUrl(selectedTable),
                  selectedTable.tableNumber.replace(/\s+/g, "_").toLowerCase(),
                )
              }
            >
              <Download className="size-4" aria-hidden="true" />
              Descargar SVG
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                printQr(
                  selectedTable.tableNumber,
                  `${selectedTable.tableNumber} · Versión ${selectedTable.qrVersion ?? 1}`,
                  tableUrl(selectedTable),
                  "Escanea para ver la carta, llamar al mesero o pedir tu cuenta",
                )
              }
            >
              <Printer className="size-4" aria-hidden="true" />
              Imprimir código
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await setQrEnabled({ tableId: selectedTable._id, enabled: !selectedTable.qrEnabled });
                  showToast(selectedTable.qrEnabled ? "Código pausado" : "Código activado");
                } catch (cause) {
                  showToast(errorMessage(cause), "err");
                }
              }}
            >
              {selectedTable.qrEnabled ? "Pausar código QR" : "Activar código QR"}
            </Button>
            <Button variant="outline" onClick={() => setConfirmRegen(selectedTable)}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Regenerar código
            </Button>
          </div>
        </AdminModal>
      )}

      {confirmRegen && (
        <ConfirmModal
          title={`Regenerar QR de ${confirmRegen.tableNumber}`}
          message="El código impreso actual dejará de funcionar y tendrás que colocar el nuevo código en la mesa."
          confirmLabel="Regenerar"
          danger
          pending={pending}
          onConfirm={() => void handleRegenerate()}
          onClose={() => setConfirmRegen(null)}
        />
      )}

      <ToastBanner toast={toast} />
    </div>
  );
}
