import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Finance Reconciliation Control Center",
  description: "Operational platform for financial reconciliation workflows",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
