import type { ReactNode } from "react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { Collage } from "@/components/collage";
import { SectionRule } from "@/components/section-rule";

export function AuthShell({
  children,
  title,
  emphasis,
  description,
  label = "Acceso",
}: {
  children: ReactNode;
  title: string;
  emphasis: string;
  description: string;
  label?: string;
}) {
  return (
    <main className="auth-shell">
      <div className="auth-art">
        <Collage name="isis" preload />
        <div className="auth-art-caption" aria-hidden="true"><span>Isis · guardiana de la entrada</span><span>Osiris / Obelisk</span></div>
      </div>
      <section className="auth-panel" aria-labelledby="auth-title">
        <Brand />
        <SectionRule roman="I" label={label} page="001 / 001" />
        <div className="auth-intro">
          <h1 className="editorial-title" id="auth-title">{title} <em>{emphasis}</em><span className="coral-dot">.</span></h1>
          <p className="lead">{description}</p>
        </div>
        {children}
        <footer className="auth-foot">
          <Link href="/">← Conocer Osiris</Link>
          <span>¿Problemas para entrar? Habla con tu gerente.</span>
        </footer>
      </section>
    </main>
  );
}
