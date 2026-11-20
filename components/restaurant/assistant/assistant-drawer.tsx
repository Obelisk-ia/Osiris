"use client";

import { useUIMessages } from "@convex-dev/agent/react";
import { useMutation, useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileSpreadsheet,
  FileText,
  History,
  ImagePlus,
  Loader2,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/format";
import { ProposalCard } from "./proposal-card";

type PendingAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  kind: "image" | "spreadsheet" | "document";
  storageId?: Id<"_storage">;
  previewUrl?: string;
  uploading: boolean;
  error?: string;
};

type ContextPage = "menu" | "inventory" | "buffet" | "floor" | "general";

const CONTEXT_LABELS: Record<ContextPage, string> = {
  menu: "Menú",
  inventory: "Inventario",
  buffet: "Buffet",
  floor: "Mesas y plano",
  general: "General",
};

const TOOL_LABELS: Record<string, string> = {
  get_restaurant_context: "Leyendo contexto del restaurante",
  list_menu: "Consultando menú actual",
  list_inventory: "Consultando inventario",
  get_floor_distribution: "Analizando distribución de mesas",
  list_buffet_menus: "Consultando menús de buffet",
  get_menu_margins: "Calculando costos y márgenes del menú",
  get_sales_and_shift_summary: "Analizando ventas y cortes de caja",
  inspect_spreadsheet: "Inspeccionando estructura del Excel",
  read_spreadsheet_rows: "Leyendo filas del Excel",
  inspect_document: "Leyendo documento",
  read_document_chunk: "Leyendo continuación del documento",
  create_section: "Creando sección",
  create_table_type: "Creando tipo de mesa",
  create_tables: "Creando mesas",
  create_suppliers: "Registrando proveedores",
  create_dish_category: "Creando categoría",
  create_buffet_menu: "Creando menú de buffet",
  propose_menu_batch: "Preparando propuesta de menú",
  propose_menu_edits: "Preparando edición de menú",
  propose_recipe_batch: "Preparando propuesta de recetas",
  propose_inventory_batch: "Preparando propuesta de inventario",
  propose_inventory_edits: "Preparando edición de inventario",
  propose_inventory_receipt: "Preparando entrada de factura",
  propose_buffet_batch: "Preparando propuesta de buffet",
  propose_floor_batch: "Preparando propuesta de mesas",
  propose_floor_layout_changes: "Preparando edición del plano",
  propose_section_assignments: "Preparando asignaciones de turno",
};

function detectContextPage(pathname: string): ContextPage {
  if (pathname.includes("/menu")) return "menu";
  if (pathname.includes("/inventario")) return "inventory";
  if (pathname.includes("/buffet")) return "buffet";
  if (pathname.includes("/mesas")) return "floor";
  return "general";
}

function isSpreadsheetFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv") ||
    file.type.includes("spreadsheet") ||
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel"
  );
}

function isDocumentFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith(".pdf") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".json") ||
    file.type === "application/pdf" ||
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    file.type === "application/json"
  );
}

async function compressImage(file: File, maxEdge = 1600): Promise<Blob> {
  if (typeof window === "undefined" || !file.type.startsWith("image/")) return file;
  return await new Promise<Blob>((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      if (scale >= 1 && file.size < 900_000) {
        resolve(file);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob ?? file),
        "image/jpeg",
        0.85,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

function starterPromptsFor(page: ContextPage, canEditMenu: boolean): string[] {
  if (page === "menu") {
    return canEditMenu
      ? [
          "Sube una foto de tu menú para extraer categorías, platillos y precios",
          "¿Qué platillos tenemos actualmente en el menú?",
          "Ayúdame a crear grupos de modificadores para bebidas o proteínas",
        ]
      : [
          "¿Qué platillos y categorías tenemos actualmente en el menú?",
          "¿Qué insumos están bajos en inventario?",
        ];
  }
  if (page === "inventory") {
    return [
      "¿Qué insumos están bajos o agotados en este momento?",
      "Sube tu Excel o CSV de inventario para importarlo automáticamente",
      "Crea un nuevo proveedor para mis insumos",
    ];
  }
  if (page === "buffet") {
    return [
      "¿Qué menús de buffet tenemos configurados?",
      "Configura un menú de buffet para hoy con nuestros platillos",
      "Sube una foto de la lista del buffet para armarlo rápido",
    ];
  }
  if (page === "floor") {
    return [
      "Muéstrame el resumen de secciones, mesas y capacidad actual",
      "Crea una sección Terraza con 6 mesas redondas de 4 personas",
      "Agrega 4 mesas cuadradas de 2 personas en el salón principal",
    ];
  }
  return [
    "Resume cómo están nuestras mesas e inventario ahora",
    ...(canEditMenu ? ["Sube fotos de tu menú para cargarlo automáticamente"] : []),
    "Sube un Excel para importar insumos y stock inicial",
  ];
}

function ThreadConversation({
  threadId,
  currencyCode,
  contextPage,
  canEditMenu,
  onSelectStarter,
}: {
  threadId: string;
  currencyCode: string;
  contextPage: ContextPage;
  canEditMenu: boolean;
  onSelectStarter: (prompt: string) => void;
}) {
  const { results: messages, status } = useUIMessages(
    api.assistant.listMessages,
    { threadId },
    { initialNumItems: 40, stream: true },
  );
  const proposals = useQuery(api.assistant.listProposals, { threadId });
  const endRef = useRef<HTMLDivElement>(null);

  const pendingProposals = useMemo(
    () => (proposals ?? []).filter((p) => p.status === "pending"),
    [proposals],
  );
  const decidedProposals = useMemo(
    () => (proposals ?? []).filter((p) => p.status !== "pending"),
    [proposals],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pendingProposals.length]);

  const starters = useMemo(() => starterPromptsFor(contextPage, canEditMenu), [contextPage, canEditMenu]);

  if (status === "LoadingFirstPage") {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Cargando conversación…
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-4 py-6">
        <div className="space-y-1.5 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <h3 className="text-base font-semibold text-foreground">¿En qué te ayudo hoy?</h3>
          <p className="text-xs text-muted-foreground">
            Puedes preguntar por mesas, inventario o menú, subir fotos de tu carta o adjuntar cualquier Excel/CSV.
          </p>
        </div>
        <div className="grid gap-2">
          {starters.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSelectStarter(prompt)}
              className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-xs text-foreground transition hover:border-foreground/40 hover:bg-muted/40"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
      {messages.map((msg) => {
        const isUser = msg.role === "user";
        const toolParts = msg.parts.filter((part) => part.type.startsWith("tool-") || part.type === "dynamic-tool");
        const imageParts = msg.parts.filter(
          (part): part is { type: "file"; mediaType: string; url: string; filename?: string } =>
            part.type === "file" && typeof (part as { mediaType?: string }).mediaType === "string" &&
            (part as { mediaType: string }).mediaType.startsWith("image/"),
        );

        const rawText = msg.text?.trim() ?? "";
        const attachedFiles: Array<{ name: string; kind: "spreadsheet" | "document" }> = [];
        const displayText = isUser
          ? rawText
              .replace(
                /\[Archivo Excel\/CSV adjunto:\s*"([^"]+)"[^\]]*\]/g,
                (_match, name: string) => {
                  attachedFiles.push({ name, kind: "spreadsheet" });
                  return "";
                },
              )
              .replace(
                /\[Documento adjunto:\s*"([^"]+)"[^\]]*\]/g,
                (_match, name: string) => {
                  attachedFiles.push({ name, kind: "document" });
                  return "";
                },
              )
              .replace(/\[Imagen adjunta:[^\]]*\]/g, "")
              .trim()
          : rawText;

        return (
          <div key={msg.key} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
            {attachedFiles.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {attachedFiles.map((file, i) => (
                  <span
                    key={`${msg.key}-file-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    {file.kind === "spreadsheet" ? (
                      <FileSpreadsheet className="size-3.5 text-emerald-600" />
                    ) : (
                      <FileText className="size-3.5 text-amber-600" />
                    )}
                    {file.name}
                  </span>
                ))}
              </div>
            )}
            {imageParts.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {imageParts.map((img, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${msg.key}-img-${i}`}
                    src={img.url}
                    alt={img.filename ?? "Imagen adjunta"}
                    className="max-h-32 max-w-[180px] rounded-lg border border-border object-cover"
                  />
                ))}
              </div>
            )}

            {!isUser && toolParts.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1">
                {toolParts.map((part, idx) => {
                  const rawName =
                    part.type === "dynamic-tool"
                      ? (part as { toolName?: string }).toolName ?? "herramienta"
                      : part.type.replace(/^tool-/, "");
                  const label = TOOL_LABELS[rawName] ?? rawName;
                  const state = (part as { state?: string }).state;
                  const running = state === "input-streaming" || state === "input-available";
                  return (
                    <span
                      key={`${msg.key}-tool-${idx}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {running ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Wrench className="size-3" />
                      )}
                      {label}
                    </span>
                  );
                })}
              </div>
            )}

            {(displayText || msg.status === "streaming") && (
              <div
                className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  isUser
                    ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                    : "border border-border bg-card text-foreground"
                }`}
              >
                {displayText ? (
                  isUser ? (
                    displayText
                  ) : (
                    <div className="space-y-2 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
                          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                          ul: ({ children }) => <ul className="list-disc space-y-1 pl-4">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-4">{children}</ol>,
                          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                          h1: ({ children }) => <h3 className="text-sm font-semibold text-foreground">{children}</h3>,
                          h2: ({ children }) => <h3 className="text-sm font-semibold text-foreground">{children}</h3>,
                          h3: ({ children }) => <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>,
                          hr: () => <hr className="my-2 border-border/70" />,
                          code: ({ children }) => (
                            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
                          ),
                          table: ({ children }) => (
                            <div className="my-1.5 overflow-x-auto rounded-lg border border-border bg-background/70">
                              <table className="w-full border-collapse text-left text-xs">{children}</table>
                            </div>
                          ),
                          thead: ({ children }) => <thead className="bg-muted/80 text-[11px] text-muted-foreground">{children}</thead>,
                          tbody: ({ children }) => <tbody className="divide-y divide-border/60">{children}</tbody>,
                          th: ({ children }) => <th className="px-2 py-1.5 font-medium whitespace-nowrap">{children}</th>,
                          td: ({ children }) => <td className="px-2 py-1.5 tabular-nums">{children}</td>,
                        }}
                      >
                        {displayText}
                      </ReactMarkdown>
                    </div>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Pensando…
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {pendingProposals.length > 0 && (
        <div className="space-y-2 pt-1">
          {pendingProposals.map((proposal) => (
            <ProposalCard key={proposal._id} proposal={proposal} currencyCode={currencyCode} />
          ))}
        </div>
      )}

      {decidedProposals.length > 0 && (
        <div className="space-y-2 pt-1 opacity-85">
          {decidedProposals.slice(0, 3).map((proposal) => (
            <ProposalCard key={proposal._id} proposal={proposal} currencyCode={currencyCode} />
          ))}
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}

export function AssistantDrawer() {
  const pathname = usePathname();
  const contextPage = detectContextPage(pathname);

  const access = useQuery(api.assistant.getAccess, {});
  const threads = useQuery(api.assistant.listThreads, access?.allowed ? {} : "skip");
  const createThread = useMutation(api.assistant.createThread);
  const generateUploadUrl = useMutation(api.assistant.generateUploadUrl);
  const sendMessage = useMutation(api.assistant.sendMessage);

  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);

  // Select most recent thread automatically when opening
  const resolvedThreadId = useMemo(() => {
    if (activeThreadId && threads?.some((t) => t.threadId === activeThreadId)) {
      return activeThreadId;
    }
    return threads?.[0]?.threadId ?? null;
  }, [activeThreadId, threads]);

  if (!access?.allowed) return null;

  async function ensureThread(): Promise<string> {
    if (resolvedThreadId) return resolvedThreadId;
    const { threadId } = await createThread({ contextPage });
    setActiveThreadId(threadId);
    return threadId;
  }

  async function handleNewThread() {
    setError(null);
    setHistoryOpen(false);
    try {
      const { threadId } = await createThread({ contextPage });
      setActiveThreadId(threadId);
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo crear una nueva conversación."));
    }
  }

  async function enqueueFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setError(null);

    for (const file of files) {
      const isImg = file.type.startsWith("image/");
      const isSheet = isSpreadsheetFile(file);
      const isDoc = !isSheet && isDocumentFile(file);
      if (!isImg && !isSheet && !isDoc) {
        setError(`Archivo no soportado: ${file.name}. Usa imágenes, Excel/CSV o documentos (PDF, TXT, MD, JSON).`);
        continue;
      }

      const kind: PendingAttachment["kind"] = isImg ? "image" : isSheet ? "spreadsheet" : "document";
      const localId = crypto.randomUUID();
      const previewUrl = isImg ? URL.createObjectURL(file) : undefined;
      setAttachments((prev) => [
        ...prev,
        {
          id: localId,
          fileName: file.name,
          mimeType:
            file.type ||
            (isSheet
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : isDoc
                ? file.name.toLowerCase().endsWith(".pdf")
                  ? "application/pdf"
                  : "text/plain"
                : "image/jpeg"),
          kind,
          previewUrl,
          uploading: true,
        },
      ]);

      try {
        const uploadUrl = await generateUploadUrl({});
        const body = isImg ? await compressImage(file) : file;
        const mimeType = isImg ? body.type || "image/jpeg" : file.type || "application/octet-stream";
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": mimeType },
          body,
        });
        if (!res.ok) throw new Error("Falló la subida del archivo.");
        const json = (await res.json()) as { storageId?: Id<"_storage"> };
        if (!json.storageId) throw new Error("No se recibió el identificador del archivo.");

        setAttachments((prev) =>
          prev.map((item) =>
            item.id === localId
              ? { ...item, storageId: json.storageId, mimeType, uploading: false }
              : item,
          ),
        );
      } catch (cause) {
        setAttachments((prev) =>
          prev.map((item) =>
            item.id === localId
              ? { ...item, uploading: false, error: errorMessage(cause, "Error al subir") }
              : item,
          ),
        );
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }

  async function handleSend(overridePrompt?: string) {
    const prompt = (overridePrompt ?? input).trim();
    const readyAttachments = attachments.filter((a) => !a.uploading && !a.error && a.storageId);
    if (attachments.some((a) => a.uploading)) return;
    if (!prompt && readyAttachments.length === 0) return;

    setSending(true);
    setError(null);
    try {
      const threadId = await ensureThread();
      await sendMessage({
        threadId,
        prompt,
        contextPage,
        attachments: readyAttachments.map((a) => ({
          storageId: a.storageId!,
          fileName: a.fileName,
          mimeType: a.mimeType,
          kind: a.kind,
        })),
      });
      setInput("");
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
      setAttachments([]);
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo enviar el mensaje."));
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void enqueueFiles(files);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      void enqueueFiles(e.dataTransfer.files);
    }
  }

  const anyUploading = attachments.some((a) => a.uploading);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-24 z-40 inline-flex items-center gap-2 rounded-full border border-border bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg transition hover:scale-[1.02] hover:opacity-95 lg:bottom-6 lg:right-6"
          aria-label="Abrir asistente IA de Osiris"
        >
          <Sparkles className="size-4" />
          <span>Asistente IA</span>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative flex h-full w-full max-w-[460px] flex-col border-l border-border bg-background shadow-2xl ${
              dragOver ? "ring-2 ring-inset ring-primary" : ""
            }`}
          >
            {/* Header */}
            <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 shrink-0 text-primary" />
                  <h2 className="truncate text-sm font-semibold text-foreground">Asistente Osiris</h2>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {CONTEXT_LABELS[contextPage]}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {access.locationName}
                  {!access.canEditMenu && " · Sin edición de menú"}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => setHistoryOpen((prev) => !prev)}
                  title="Historial de conversaciones"
                  aria-label="Historial de conversaciones"
                >
                  <History className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => void handleNewThread()}
                  title="Nueva conversación"
                  aria-label="Nueva conversación"
                >
                  <Plus className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar asistente"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </header>

            {/* Thread history dropdown */}
            {historyOpen && (
              <div className="max-h-56 overflow-y-auto border-b border-border bg-muted/30 p-2">
                <div className="mb-1.5 flex items-center justify-between px-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Conversaciones recientes
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleNewThread()}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    + Nueva
                  </button>
                </div>
                {threads && threads.length > 0 ? (
                  <div className="space-y-1">
                    {threads.map((t) => (
                      <button
                        key={t._id}
                        type="button"
                        onClick={() => {
                          setActiveThreadId(t.threadId);
                          setHistoryOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition ${
                          t.threadId === resolvedThreadId
                            ? "bg-card font-medium text-foreground shadow-xs"
                            : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
                        }`}
                      >
                        <span className="truncate">{t.title}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-2 py-2 text-xs text-muted-foreground">Aún no hay conversaciones previas.</p>
                )}
              </div>
            )}

            {/* Messages */}
            {resolvedThreadId ? (
              <ThreadConversation
                threadId={resolvedThreadId}
                currencyCode={access.currencyCode}
                contextPage={contextPage}
                canEditMenu={access.canEditMenu}
                onSelectStarter={(prompt) => void handleSend(prompt)}
              />
            ) : (
              <div className="flex flex-1 flex-col justify-center gap-4 px-4 py-6">
                <div className="space-y-1.5 text-center">
                  <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Sparkles className="size-5" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">¿En qué te ayudo hoy?</h3>
                  <p className="text-xs text-muted-foreground">
                    Sube fotos de tu menú, adjunta un Excel de inventario o pídele crear mesas y menús de buffet.
                  </p>
                </div>
                <div className="grid gap-2">
                  {starterPromptsFor(contextPage, access.canEditMenu).map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void handleSend(prompt)}
                      className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-xs text-foreground transition hover:border-foreground/40 hover:bg-muted/40"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Drag overlay hint */}
            {dragOver && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/85">
                <div className="rounded-2xl border-2 border-dashed border-primary px-6 py-5 text-center">
                  <Paperclip className="mx-auto size-6 text-primary" />
                  <p className="mt-2 text-sm font-semibold">Suelta fotos o archivos Excel aquí</p>
                </div>
              </div>
            )}

            {/* Composer */}
            <div className="border-t border-border bg-card/50 p-3">
              {error && (
                <div className="mb-2 flex items-center justify-between rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                  <span>{error}</span>
                  <button type="button" onClick={() => setError(null)} aria-label="Cerrar error">
                    <X className="size-3.5" />
                  </button>
                </div>
              )}

              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-xs"
                    >
                      {att.kind === "image" && att.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={att.previewUrl}
                          alt={att.fileName}
                          className="size-5 rounded object-cover"
                        />
                      ) : att.kind === "spreadsheet" ? (
                        <FileSpreadsheet className="size-4 text-emerald-600" />
                      ) : (
                        <FileText className="size-4 text-amber-600" />
                      )}
                      <span className="max-w-[140px] truncate">{att.fileName}</span>
                      {att.uploading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                      {att.error && <span className="text-destructive">Error</span>}
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Quitar ${att.fileName}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-1.5">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) void enqueueFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={sheetInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf,.txt,.md,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/pdf,text/plain,text/markdown,application/json"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) void enqueueFiles(e.target.files);
                    e.target.value = "";
                  }}
                />

                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="size-9 shrink-0"
                  onClick={() => imageInputRef.current?.click()}
                  title="Adjuntar foto de menú o captura"
                  aria-label="Adjuntar foto"
                >
                  <ImagePlus className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="size-9 shrink-0"
                  onClick={() => sheetInputRef.current?.click()}
                  title="Adjuntar Excel, CSV, PDF o TXT"
                  aria-label="Adjuntar archivo"
                >
                  <Paperclip className="size-4" />
                </Button>

                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  rows={1}
                  placeholder="Escribe o pega una foto…"
                  className="max-h-28 min-h-9 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
                />

                <Button
                  type="button"
                  size="icon"
                  className="size-9 shrink-0"
                  disabled={sending || anyUploading || (!input.trim() && attachments.length === 0)}
                  onClick={() => void handleSend()}
                  aria-label="Enviar mensaje"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>

              <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0" />
                <span>Solo lectura y creación · Las cargas masivas piden tu confirmación</span>
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
