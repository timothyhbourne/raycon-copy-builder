import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppNav from "@/components/AppNav";
import { ToastViewport } from "@/components/ui/Toast";

// Self-hosted via next/font — no external font request at runtime. Exposed as CSS
// variables so the token layer (@theme --font-sans / --font-mono) drives every
// component. Inter replaced DM Sans because it holds up far better in dense data
// tables at the same pixel footprint (DM Sans's geometric a/g read quirky at
// label sizes). JetBrains Mono is reserved for tabular numerics only.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
    <html lang="en" className={`h-full ${inter.variable} ${jetBrainsMono.variable} font-sans`}>
      {/* §4.0: the grey ground fills the window; the nav sits directly on it and
          the route's content is an inset white panel (.rc-content-panel). */}
      <body className="h-full flex bg-chrome">
        <AppNav />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</div>
        <ToastViewport />
      </body>
    </html>
  );
}
