import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A&O Interactive Services Dashboard",
  description: "Field survey dashboard powered by Perigee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
