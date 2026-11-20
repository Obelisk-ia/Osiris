import { useMutation } from "convex/react";
import { useEffect, useState, type FormEvent } from "react";
import { MenuBackdrop } from "@/components/restaurant/diner/menu-backdrop";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/format";
import { MAX_MENU_BACKGROUND_BYTES, type MenuBackground } from "@/lib/menu-appearance";
import { compressImageForUpload, validateImageFile } from "@/lib/image-upload";
import { ToastBanner, useToast } from "./admin-ui";

const DEFAULT_COLOR = "#9eac86";
const BACKGROUNDS = [
  { kind: "default", label: "Fondo de Osiris" },
  { kind: "color", label: "Color sólido" },
  { kind: "photo", label: "Foto" },
] as const;

export function MenuAppearancePanel({
  restaurantName,
  background,
}: {
  restaurantName: string;
  background: MenuBackground;
}) {
  const saveBackground = useMutation(api.menu.updateMenuBackground);
  const { toast, showToast } = useToast();
  const [draftKind, setDraftKind] = useState<MenuBackground["kind"] | null>(null);
  const [draftColor, setDraftColor] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return () => { if (photo) URL.revokeObjectURL(photo.url); };
  }, [photo]);

  const kind = draftKind ?? background.kind;
  const color = draftColor ?? (background.kind === "color" ? background.color : DEFAULT_COLOR);
  const photoUrl = photo?.url ?? (background.kind === "photo" ? background.url : null);
  const preview: MenuBackground = kind === "color" ? { kind, color }
    : kind === "photo" && photoUrl ? { kind, url: photoUrl } : { kind: "default" };
  const canSave = kind === "photo" ? photo !== null
    : kind !== background.kind || (kind === "color" && background.kind === "color" && color !== background.color);

  function selectPhoto(file?: File) {
    setPhoto(null);
    setError(null);
    if (!file) return;
    const validationError = validateImageFile(file, "menuBackground");
    if (validationError) {
      setError(validationError);
      return;
    }
    setPhoto({ file, url: URL.createObjectURL(file) });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canSave) return;
    setError(null);
    setPending(true);
    try {
      if (kind === "photo") {
        if (!photo) return;
        // Compress in the browser (WebP, max 1200px, high quality) before the bytes
        // are sent to Convex storage, so the QR menu loads fast on diners' phones.
        const compressed = await compressImageForUpload(photo.file, "menuBackground");
        if (compressed.compressedBytes > MAX_MENU_BACKGROUND_BYTES) {
          throw new Error("La imagen optimizada sigue pesando más de 3 MB; prueba una foto más liviana.");
        }
        await saveBackground({ background: { kind, bytes: await compressed.file.arrayBuffer() } });
      } else {
        await saveBackground({ background: kind === "color" ? { kind, color } : { kind } });
      }
      setDraftKind(null);
      setDraftColor(null);
      setPhoto(null);
      showToast("Fondo del menú actualizado");
    } catch (cause) {
      setError(errorMessage(cause, "No pudimos guardar el fondo del menú."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_17rem]">
      <form className="az-card grid gap-5" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-1">
          <h2 className="font-heading text-xl font-extrabold">Fondo del menú</h2>
          <p className="text-sm text-muted-foreground">
            Se aplica a la carta pública y a los QR de mesa de todas tus sucursales.
          </p>
        </div>
        <fieldset disabled={pending} className="m-0 grid gap-3 border-0 p-0">
          <legend className="mb-3 text-sm font-semibold">Tipo de fondo</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {BACKGROUNDS.map((option) => (
              <label key={option.kind} className="flex items-center gap-2 text-sm">
                <input type="radio" name="menu-background" className="size-4 accent-foreground" checked={kind === option.kind} onChange={() => { setDraftKind(option.kind); setError(null); }} />
                {option.label}
              </label>
            ))}
          </div>
          {kind === "color" && (
            <label className="flex items-center gap-3 text-sm font-medium">
              <input
                type="color"
                className="h-10 w-14 cursor-pointer rounded-md border border-border bg-transparent p-1"
                value={color}
                onChange={(event) => setDraftColor(event.target.value)}
              />
              Color del fondo
            </label>
          )}
          {kind === "photo" && (
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="menu-background-photo"
                  type="file"
                  className="peer sr-only"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  aria-describedby="menu-background-photo-hint"
                  onChange={(event) => {
                    selectPhoto(event.currentTarget.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
                <label htmlFor="menu-background-photo" className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-border bg-background px-3 text-sm font-semibold hover:border-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
                  Elegir foto del fondo
                </label>
                {photo && <span className="break-all text-sm" role="status">{photo.file.name}</span>}
              </div>
              <p id="menu-background-photo-hint" className="text-xs text-muted-foreground">
                JPG, PNG, WebP o AVIF de hasta 15 MB. Se convierte a WebP optimizada (máx. 1200 px, alta calidad) para que la carta cargue rápido.
              </p>
            </div>
          )}
        </fieldset>
        {error && <p className="floor-error" role="alert">{error}</p>}
        <Button type="submit" className="site-button justify-self-start" disabled={pending || !canSave}>
          {pending ? "Guardando…" : "Guardar fondo"}
        </Button>
      </form>

      <figure className="mx-auto grid w-full max-w-[17rem] gap-2">
        <figcaption className="text-sm font-semibold">Vista previa móvil</figcaption>
        <div className="relative isolate min-h-64 overflow-hidden rounded-2xl border border-border bg-background">
          <MenuBackdrop background={preview} preview />
          <div className="relative z-10">
            <div className="flex items-baseline gap-2 border-b border-border bg-[#efe7d2ee] px-4 py-3">
              <span className="brand-mark" aria-hidden="true">Ø</span>
              <strong className="truncate font-heading text-sm">{restaurantName}</strong>
            </div>
            <div className="px-4 py-5">
              <p className="editorial-title !text-3xl">Menú<span className="coral-dot">.</span></p>
              <div className="az-card mt-4 text-sm" aria-hidden="true">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>Platillo del día</strong>
                  <span className="az-money">$150</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </figure>
      <ToastBanner toast={toast} />
    </div>
  );
}
