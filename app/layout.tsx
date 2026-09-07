import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Notisen",
  description: "Hold styr på oppsigelsesfrister og bindingstid for leverandøravtaler.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nb">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
