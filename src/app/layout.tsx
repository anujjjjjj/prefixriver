import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const ui = Inter_Tight({
  variable: "--font-ui",
  subsets: ["latin"],
  display: "swap",
});

const code = JetBrains_Mono({
  variable: "--font-code",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://prefixriver.vercel.app";
const title = "PrefixRiver — see where your prompt cache breaks";
const description =
  "Drop a capture of your AI agent's LLM requests and see exactly where the prompt cache breaks, why, and what each break costs. 100% local — nothing leaves your browser.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: "PrefixRiver",
  keywords: ["prompt caching", "LLM", "Anthropic", "OpenAI", "agents", "cache hit rate", "token cost"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "PrefixRiver",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: "#05070d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${ui.variable} ${code.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
