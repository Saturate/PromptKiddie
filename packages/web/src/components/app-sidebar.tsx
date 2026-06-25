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
  TerminalIcon,
  TargetIcon,
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
    title: "Stats",
    url: "/stats",
    icon: <BarChart3Icon />,
  },
]

const navSecondary = [
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
  const [engagements, setEngagements] = React.useState<Engagement[]>(() => {
    if (typeof window === "undefined") return []
    try {
      return JSON.parse(localStorage.getItem("pk-sidebar-engagements") ?? "[]")
    } catch { return [] }
  })

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
              <TerminalIcon className="size-5!" />
              <span className="text-base font-semibold">PromptKiddie</span>
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
        <div className="px-2 py-1 text-xs text-muted-foreground font-mono">
          promptkiddie v0.1.0
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
