import type { Metadata } from "next";
import "./globals.css";
import AppNav from "@/components/AppNav";
import { ToastViewport } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "Raycon Tools",
  description: "Internal email campaign tools",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex bg-chrome">
        <AppNav />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</div>
        <ToastViewport />
      </body>
    </html>
  );
}
