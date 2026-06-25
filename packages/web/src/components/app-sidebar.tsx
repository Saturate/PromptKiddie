"use client"

import * as React from "react"
import { NavMain } from "@/components/nav-main"
import { NavDocuments } from "@/components/nav-documents"
import { NavSecondary } from "@/components/nav-secondary"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  LayoutDashboardIcon,
  TargetIcon,
  Settings2Icon,
  BookOpenIcon,
  TerminalIcon,
} from "lucide-react"

const navMain = [
  {
    title: "Dashboard",
    url: "/",
    icon: <LayoutDashboardIcon />,
  },
  {
    title: "Targets",
    url: "#",
    icon: <TargetIcon />,
  },
]

const navSecondary = [
  {
    title: "Settings",
    url: "#",
    icon: <Settings2Icon />,
  },
  {
    title: "Docs",
    url: "#",
    icon: <BookOpenIcon />,
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [engagements, setEngagements] = React.useState<
    { id: string; name: string; phase: string | null }[]
  >([])

  React.useEffect(() => {
    fetch("/api/engagements")
      .then((r) => r.json())
      .then(setEngagements)
      .catch(() => {})
  }, [])

  const engagementDocs = engagements.map((e) => ({
    name: e.name,
    url: `/engagements/${e.id}`,
    icon: <TargetIcon />,
  }))

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
        <NavDocuments items={engagementDocs} />
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
