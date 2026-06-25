import type { Metadata } from "next";
import "./globals.css";
import { JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app-sidebar";
import { listEngagements } from "@promptkiddie/core";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PromptKiddie",
  description: "Ethical hacking workspace",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const engagements = await listEngagements();

  return (
    <html lang="en" className={cn("dark", mono.variable)} suppressHydrationWarning>
      <body className="font-mono antialiased">
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar
              engagements={engagements.map((e) => ({
                id: e.id,
                name: e.name,
                type: e.type,
                status: e.status,
                phase: e.phase,
              }))}
            />
            <SidebarInset>
              <header className="flex h-12 items-center gap-2 border-b border-border px-4">
                <SidebarTrigger className="-ml-1" />
              </header>
              <main className="flex-1 overflow-auto">
                {children}
              </main>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
