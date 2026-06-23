import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PromptKiddie",
  description: "Ethical hacking workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header
          style={{
            borderBottom: "1px solid var(--border)",
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <a href="/" style={{ fontWeight: 700, fontSize: "1.1rem" }}>
            pk
          </a>
          <a href="/" className="dim" style={{ fontSize: "0.85rem" }}>
            engagements
          </a>
        </header>
        {children}
      </body>
    </html>
  );
}
