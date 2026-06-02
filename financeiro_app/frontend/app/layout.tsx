import "./globals.css";
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
