import "./globals.css";
import "./responsive.css";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { KivoBackground } from "../components/KivoBackground";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata = {
  title: "KIVO — ERP operacional",
  description: "Plataforma KIVO para Comex, financeiro e automações por setor",
  icons: {
    icon: [
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/brand/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/brand/favicon-192.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable} data-kivo-bg="degrade">
      <body className={inter.className}>
        <KivoBackground />
        {children}
      </body>
    </html>
  );
}
