import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { OfflineBanner, ServiceWorkerRegistrar } from "@/components/pwa/pwa";
import { brand } from "@/config/brand";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

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
  title: {
    default: brand.name,
    template: `%s · ${brand.name}`,
  },
  description: brand.description,
  applicationName: brand.name,
  appleWebApp: { capable: true, title: brand.shortName, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: brand.colors.themeLight },
    { media: "(prefers-color-scheme: dark)", color: brand.colors.themeDark },
  ],
  // Lets the layout extend under phone notches; the shell pads with safe-area insets.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script sets the `dark` class before hydration.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <OfflineBanner />
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
