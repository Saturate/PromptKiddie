"use client"

import * as React from "react"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
} from "@/components/ui/sidebar"
import {
  LayoutDashboardIcon,
  FolderOpenIcon,
  BarChart3Icon,
  Settings2Icon,
  BookOpenIcon,
  TargetIcon,
  MessageSquareIcon,
  WrenchIcon,
  ListChecksIcon,
} from "lucide-react"

const navMain = [
  {
    title: "Dashboard",
    url: "/",
    icon: <LayoutDashboardIcon />,
  },
  {
    title: "Engagements",
    url: "/engagements",
    icon: <FolderOpenIcon />,
  },
  {
    title: "Chat",
    url: "/chat",
    icon: <MessageSquareIcon />,
  },
  {
    title: "Tools",
    url: "/tools",
    icon: <WrenchIcon />,
  },
  {
    title: "Stats",
    url: "/stats",
    icon: <BarChart3Icon />,
  },
]

const navSecondary = [
  {
    title: "Playbooks",
    url: "/settings/playbooks",
    icon: <ListChecksIcon />,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: <Settings2Icon />,
  },
  {
    title: "Docs",
    url: "#",
    icon: <BookOpenIcon />,
  },
]

interface Engagement {
  id: string
  name: string
  phase: string | null
  group: string | null
  status: string
}

const MAX_RECENTS = 5

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [engagements, setEngagements] = React.useState<Engagement[]>([])
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    try {
      const cached = JSON.parse(localStorage.getItem("pk-sidebar-engagements") ?? "[]")
      if (cached.length) setEngagements(cached)
    } catch { /* ignore */ }
  }, [])

  React.useEffect(() => {
    fetch("/api/engagements")
      .then((r) => r.json())
      .then((data: Engagement[]) => {
        setEngagements(data)
        localStorage.setItem("pk-sidebar-engagements", JSON.stringify(data))
      })
      .catch(() => {})
  }, [])

  const recents = engagements.slice(0, MAX_RECENTS)
  const hasMore = engagements.length > MAX_RECENTS

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="/" />}
            >
              <svg viewBox="0 0 36 36" fill="none" className="size-7! shrink-0">
                <circle cx="18" cy="18" r="13" stroke="currentColor" strokeWidth="1.5" className="text-primary/30" />
                <line x1="18" y1="2" x2="18" y2="10" stroke="currentColor" strokeWidth="1.2" className="text-primary/40" />
                <line x1="18" y1="26" x2="18" y2="34" stroke="currentColor" strokeWidth="1.2" className="text-primary/40" />
                <line x1="2" y1="18" x2="10" y2="18" stroke="currentColor" strokeWidth="1.2" className="text-primary/40" />
                <line x1="26" y1="18" x2="34" y2="18" stroke="currentColor" strokeWidth="1.2" className="text-primary/40" />
                <text x="10.5" y="22" fontFamily="inherit" fontSize="11" fontWeight="700" fill="currentColor" className="text-primary">pk</text>
              </svg>
              <span className="text-base">
                <span className="font-light text-sidebar-foreground/70">Prompt</span>
                <span className="font-bold">Kiddie</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />

        {/* Recents */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Recent Engagements</SidebarGroupLabel>
          <SidebarMenu>
            {recents.length === 0 && (
              <SidebarMenuItem>
                <SidebarMenuButton className="text-sidebar-foreground/50" disabled>
                  <span>No engagements</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {recents.map((e) => (
              <SidebarMenuItem key={e.id}>
                <SidebarMenuButton render={<a href={`/engagements/${e.id}`} />}>
                  <TargetIcon />
                  <span>{e.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {hasMore && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<a href="/engagements" />}
                  className="text-muted-foreground text-xs"
                >
                  <span>View all ({engagements.length})</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>

        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 py-1 space-y-0.5">
          <div className="text-[10px] text-muted-foreground/50 font-mono">v0.1.0</div>
          <div className="text-[10px] text-primary/40 font-mono italic">definitely not a script kiddie</div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
