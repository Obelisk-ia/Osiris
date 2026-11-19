import Image from "next/image";
import { cn } from "@/lib/utils";

const collages = {
  landing: { width: 1400, height: 931, alt: "Collage de Osiris en su trono, un disco solar, columnas de templo y pirámides" },
  horus: { width: 900, height: 893, alt: "Collage de Horus con cabeza de halcón y el Ojo de Horus" },
  sekhmet: { width: 900, height: 887, alt: "Collage de Sekhmet con cabeza de leona entre llamas de papel" },
  anubis: { width: 880, height: 900, alt: "Collage de Anubis sosteniendo una balanza" },
  thot: { width: 891, height: 900, alt: "Collage de Thot escribiendo sobre una paleta de escriba" },
  hathor: { width: 900, height: 878, alt: "Collage de Hathor entre flores de loto" },
  isis: { width: 879, height: 900, alt: "Collage de Isis con las alas abiertas, guardiana de la entrada" },
} as const;

export function Collage({
  name,
  className,
  framed = true,
  preload = false,
}: {
  name: keyof typeof collages;
  className?: string;
  framed?: boolean;
  preload?: boolean;
}) {
  const image = collages[name];
  return (
    <figure className={cn("collage", className)}>
      <div className={cn("plate", framed && "plate-framed")}>
        <Image
          src={`/collage/${name}.webp`}
          width={image.width}
          height={image.height}
          alt={image.alt}
          preload={preload}
          sizes={name === "landing" ? "(min-width: 960px) 70vw, 100vw" : "(min-width: 960px) 44vw, 90vw"}
        />
      </div>
    </figure>
  );
}
