"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  LayoutDashboardIcon,
  CrosshairIcon,
  ShieldAlertIcon,
  ActivityIcon,
  FileTextIcon,
  MessageSquareIcon,
  TargetIcon,
} from "lucide-react";

interface Engagement {
  id: string;
  name: string;
  type: string;
  status: string;
  phase: string | null;
}

const engagementSections = [
  { label: "Overview", hash: "", icon: LayoutDashboardIcon },
  { label: "Targets", hash: "#targets", icon: CrosshairIcon },
  { label: "Findings", hash: "#findings", icon: ShieldAlertIcon },
  { label: "Activity", hash: "#activity", icon: ActivityIcon },
  { label: "Evidence", hash: "#evidence", icon: FileTextIcon },
  { label: "Inbox", hash: "#inbox", icon: MessageSquareIcon },
];

export function AppSidebar({ engagements }: { engagements: Engagement[] }) {
  const pathname = usePathname();
  const activeEngId = pathname.startsWith("/engagements/")
    ? pathname.split("/")[2]
    : null;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-4">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <TargetIcon className="h-5 w-5 text-pk-green" />
          <span className="text-sm font-bold text-pk-green font-mono tracking-tight group-data-[collapsible=icon]:hidden">
            PromptKiddie
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/" />}
                  isActive={pathname === "/"}
                  className="font-mono text-xs"
                >
                  <LayoutDashboardIcon className="h-4 w-4" />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-widest">
            Engagements
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {engagements.length === 0 && (
                <SidebarMenuItem>
                  <span className="px-2 py-1 text-[11px] text-muted-foreground font-mono">
                    No engagements
                  </span>
                </SidebarMenuItem>
              )}
              {engagements.map((e) => (
                <SidebarMenuItem key={e.id}>
                  <SidebarMenuButton
                    render={<Link href={`/engagements/${e.id}`} />}
                    isActive={activeEngId === e.id}
                    className="font-mono text-xs"
                  >
                    <CrosshairIcon className="h-4 w-4" />
                    <span className="truncate">{e.name}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge className="font-mono text-[9px] uppercase">
                    {e.phase ?? e.status}
                  </SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {activeEngId && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-widest">
              Sections
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {engagementSections.map((s) => (
                  <SidebarMenuItem key={s.label}>
                    <SidebarMenuButton
                      render={<Link href={`/engagements/${activeEngId}${s.hash}`} />}
                      className="font-mono text-xs"
                    >
                      <s.icon className="h-4 w-4" />
                      <span>{s.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="px-4 py-2">
        <p className="text-[10px] text-muted-foreground font-mono group-data-[collapsible=icon]:hidden">
          promptkiddie v0.1.0
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
