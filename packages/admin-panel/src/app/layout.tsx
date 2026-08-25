import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NeuroWealth Admin Panel",
  description: "Contract owner dashboard for vault management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
