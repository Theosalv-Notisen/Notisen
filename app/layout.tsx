import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-schibsted",
});

export const metadata: Metadata = {
  title: "Notisen",
  description: "Hold styr på oppsigelsesfrister og bindingstid for leverandøravtaler.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nb" className={schibsted.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
