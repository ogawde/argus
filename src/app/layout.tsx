import type { Metadata } from "next";
import { Fraunces, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Display serif for headlines, a friendly grotesque for UI text, mono for money and hashes.
const display = Fraunces({
  variable: "--font-argus-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

const body = Instrument_Sans({
  variable: "--font-argus-body",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-argus-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Argus — plan before you pay",
  description: "Plan before you pay — batch payout review and apply",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${mono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
