import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { Collage } from "@/components/collage";
import { LinkButton } from "@/components/link-button";
import { SectionRule } from "@/components/section-rule";

const chapters = [
  {
    id: "mesas", name: "Mesas", roman: "I", deity: "Horus vigila el salón",
    title: "El plano,", emphasis: "como tu salón", collage: "horus",
    features: [
      "Dibuja secciones y arrastra cada mesa hasta su lugar real.",
      "Cada mesa dice si está libre, ocupada, con pedido listo o si ya quieren pagar.",
      "El mesero ve sus mesas asignadas y el progreso de cada pedido.",
    ],
  },
  {
    id: "cocina", name: "Cocina", roman: "II", deity: "Sekhmet cuida el fuego",
    title: "Cada pedido,", emphasis: "a tiempo", collage: "sekhmet",
    features: [
      "Lo que confirma el mesero o pide la mesa desde el QR llega a cocina y barra.",
      "Nuevos, preparando y listos en una sola pantalla, con los comentarios a la vista.",
      "Recetas e inventario conectados para llevar el control de cada insumo.",
    ],
  },
  {
    id: "caja", name: "Caja", roman: "III", deity: "Anubis sostiene la balanza",
    title: "El corte,", emphasis: "cuadrado", collage: "anubis",
    features: [
      "Efectivo, tarjeta, transferencia y vales, solos o combinados.",
      "Turno con fondo inicial, retiros e ingresos registrados.",
      "Efectivo esperado, contado y diferencia, sin mezclar propinas ni pagos en línea.",
    ],
  },
  {
    id: "reportes", name: "Reportes", roman: "IV", deity: "Thot lleva los registros",
    title: "Todo queda", emphasis: "escrito", collage: "thot",
    features: [
      "Ventas por producto, categoría, hora y mesero.",
      "Insumos bajo el umbral y lista de compras por proveedor.",
      "Bitácora de cancelaciones y descuentos, con quién los autorizó.",
    ],
  },
  {
    id: "comensal", name: "La mesa", roman: "V", deity: "Hathor recibe a los comensales",
    title: "Pedir y pagar,", emphasis: "desde la mesa", collage: "hathor",
    features: [
      "Escanean el QR y piden sin instalar nada ni crear una cuenta.",
      "Comentarios por orden: dos de pastor, una sin cilantro.",
      "Dividen la cuenta tocando sus platos y cada quien paga su parte.",
    ],
  },
] as const;

const steps = [
  ["Abrir turno", "Caja abre con su fondo y la sucursal empieza a recibir pedidos."],
  ["Tomar orden", "El mesero arma la orden, la confirma y la envía a cocina."],
  ["Preparar y entregar", "Cocina marca listo; el mesero lleva cada plato a su mesa."],
  ["Cortar caja", "Caja cuadra el efectivo y el dueño ve el día completo en reportes."],
] as const;

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <header className="site-nav">
        <Brand />
        <nav className="nav-links" aria-label="Capítulos">
          {chapters.map((chapter) => <a key={chapter.id} href={`#${chapter.id}`}>{chapter.name}</a>)}
        </nav>
        <LinkButton href="/acceso" variant="outline" className="nav-access">Entrar <ArrowUpRight aria-hidden="true" /></LinkButton>
      </header>

      <main id="contenido">
        <section className="site-wrap hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 className="editorial-title" id="hero-title">Tu restaurante, <em>en orden</em><span className="coral-dot">.</span></h1>
            <p className="lead">Mesas, cocina, caja e inventario en un mismo lugar. Del primer pedido al corte de caja.</p>
            <div className="hero-actions">
              <LinkButton href="/acceso">Entrar a Osiris <ArrowUpRight aria-hidden="true" /></LinkButton>
              <LinkButton href="#metodo" variant="outline">Ver cómo funciona</LinkButton>
            </div>
            <nav className="index-card" aria-label="Índice">
              {chapters.map((chapter, index) => (
                <a href={`#${chapter.id}`} key={chapter.id}><span>0{index + 1}</span>{chapter.name}<ArrowUpRight aria-hidden="true" /></a>
              ))}
            </nav>
          </div>
          <Collage name="landing" className="hero-art" framed={false} preload />
        </section>

        {chapters.map((chapter, index) => (
          <section className={`site-wrap chapter ${index % 2 ? "chapter-flip" : ""}`} id={chapter.id} key={chapter.id} aria-labelledby={`title-${chapter.id}`}>
            <SectionRule roman={chapter.roman} label={`${chapter.name} · ${chapter.deity}`} page={`00${index + 1} / 007`} />
            <div className="chapter-grid">
              <div className="chapter-copy">
                <h2 className="editorial-title" id={`title-${chapter.id}`}>{chapter.title} <em>{chapter.emphasis}</em><span className="coral-dot">.</span></h2>
                <ul className="feature-list">
                  {chapter.features.map((feature, featureIndex) => (
                    <li key={feature}><span aria-hidden="true">{["i.", "ii.", "iii."][featureIndex]}</span>{feature}</li>
                  ))}
                </ul>
              </div>
              <Collage name={chapter.collage} className="chapter-art" />
            </div>
          </section>
        ))}

        <section className="site-wrap chapter method" id="metodo" aria-labelledby="method-title">
          <SectionRule roman="VI" label="Método · un día de servicio" page="006 / 007" />
          <h2 className="editorial-title" id="method-title">Un día, <em>de principio a fin</em><span className="coral-dot">.</span></h2>
          <ol className="steps-list">
            {steps.map(([title, description], index) => (
              <li key={title} className="step">
                <span className="step-number" aria-hidden="true">0{index + 1}</span>
                <h3>{title}{index < 3 && <ArrowRight aria-hidden="true" />}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="site-wrap" aria-labelledby="access-title">
          <SectionRule roman="VII" label="Acceso · Isis guarda la puerta" page="007 / 007" />
          <div className="landing-cta">
            <div className="hero-copy">
              <h2 className="editorial-title" id="access-title">Entra al <em>sistema</em><span className="coral-dot">.</span></h2>
              <p className="lead">Inicia sesión o crea tu cuenta en Osiris.</p>
              <div className="hero-actions">
                <LinkButton href="/acceso">Iniciar sesión <ArrowUpRight aria-hidden="true" /></LinkButton>
                <LinkButton href="/crear-cuenta" variant="outline">Crear cuenta</LinkButton>
              </div>
              <p className="small-note">La plataforma está en desarrollo. Estas son las funciones que estamos construyendo.</p>
            </div>
            <Collage name="isis" className="cta-art" />
          </div>
        </section>
      </main>

      <footer className="site-wrap site-footer">
        <p className="footer-word">Osiris<span className="coral-dot">.</span></p>
        <div className="footer-meta"><span>Hecho por Obelisk</span><a href="/acceso">Iniciar sesión →</a></div>
      </footer>
    </>
  );
}
