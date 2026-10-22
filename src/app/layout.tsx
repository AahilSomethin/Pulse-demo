import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense, type ReactNode } from "react";

import { MaritimeProvider } from "@/context/MaritimeContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SeaPulse",
  description: "Maritime activity from FollowMe vessel tracks.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} data-theme="dark" suppressHydrationWarning>
      <body className="min-h-full">
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('seapulse-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}",
          }}
        />
        <Suspense fallback={<p className="p-6 text-sm text-fg-muted">Loading SeaPulse…</p>}>
          <ThemeProvider>
            <MaritimeProvider>
              <WorkspaceProvider>{children}</WorkspaceProvider>
            </MaritimeProvider>
          </ThemeProvider>
        </Suspense>
      </body>
    </html>
  );
}
