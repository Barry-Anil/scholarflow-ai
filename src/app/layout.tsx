import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ScholarFlow AI", template: "%s · ScholarFlow AI" },
  description:
    "An evidence-led academic assignment workspace with supervised AI agents.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      data-scroll-behavior="smooth"
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
