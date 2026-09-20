import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/toast/ToastProvider";
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
  title: "ShiftSync",
  description: "Multi-location staff scheduling for Coastal Eats",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      {/* Deliberately not `flex`: a flex item's default `min-width: auto`
          means it won't shrink below its content's intrinsic width, which
          let a wide table silently force the ENTIRE page to overflow
          horizontally on mobile even though the table itself sat inside
          its own `overflow-x-auto` container -- the overflow-x-auto never
          got a chance to clip anything because `<main>`, as a flex item of
          `<body>`, had already grown to fit the table's min-content width.
          Plain block flow doesn't have that quirk: a block child always
          shrinks to its container's width regardless of its own content,
          so `overflow-x-auto` containers nested inside it work as
          expected. */}
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
