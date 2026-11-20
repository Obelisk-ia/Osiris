import type { MenuBackground } from "@/lib/menu-appearance";

export function MenuBackdrop({ background, preview = false }: { background: MenuBackground; preview?: boolean }) {
  return (
    <div
      className={`az-backdrop${preview ? " !absolute" : ""}`}
      data-menu-background={background.kind}
      aria-hidden="true"
      style={background.kind === "color" ? {
        backgroundColor: `color-mix(in srgb, var(--background) 66%, ${background.color})`,
      } : undefined}
    >
      {background.kind === "default" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={`az-backdrop-img${preview ? " !h-[90%]" : ""}`} src="/collage/hathor.webp" alt="" />
      )}
      {background.kind === "photo" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={background.url} alt="" className="size-full object-cover opacity-30" />
      )}
    </div>
  );
}
