import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono, Playfair_Display } from "next/font/google";
import { Suspense } from "react";
import { ConvexAuthNextjsServerProvider } from "@/lib/convex-auth";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: "italic",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Osiris · Tu restaurante, en orden", template: "%s · Osiris" },
  description: "Mesas, cocina, caja e inventario en una sola plataforma para restaurantes en México. Del primer pedido al corte de caja.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-MX"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${interTight.variable} ${playfair.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body>
        <Suspense fallback={<div className="page-loading" role="status">Cargando Osiris…</div>}>
          <ConvexAuthNextjsServerProvider>{children}</ConvexAuthNextjsServerProvider>
        </Suspense>
      </body>
    </html>
  );
}
