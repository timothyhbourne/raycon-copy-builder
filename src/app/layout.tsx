import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppNav from "@/components/AppNav";
import { ToastViewport } from "@/components/ui/Toast";

// Self-hosted via next/font (replaces the old Google Fonts @import in globals.css).
// Exposed as CSS variables so the token layer (@theme --font-sans / --font-mono)
// drives every component. DM Sans is the one display sans; JetBrains Mono is
// reserved for tabular numerics only.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Raycon Tools",
  description: "Internal email campaign tools",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${dmSans.variable} ${jetBrainsMono.variable} font-sans`}>
      <body className="h-full flex bg-chrome">
        <AppNav />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</div>
        <ToastViewport />
      </body>
    </html>
  );
}
