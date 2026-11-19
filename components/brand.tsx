import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Osiris, inicio">
      <span className="brand-mark" aria-hidden="true">Ø</span>
      <strong>Osiris</strong>
    </Link>
  );
}
