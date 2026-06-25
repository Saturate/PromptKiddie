"use client"

import * as React from "react"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { CreateEngagementDialog } from "@/components/create-engagement-dialog"
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  LayoutDashboardIcon,
  Settings2Icon,
  BookOpenIcon,
  TerminalIcon,
  TargetIcon,
  ChevronRightIcon,
  CirclePlusIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"

const navMain = [
  {
    title: "Dashboard",
    url: "/",
    icon: <LayoutDashboardIcon />,
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

interface Engagement {
  id: string
  name: string
  phase: string | null
  group: string | null
  status: string
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [engagements, setEngagements] = React.useState<Engagement[]>([])

  React.useEffect(() => {
    fetch("/api/engagements")
      .then((r) => r.json())
      .then(setEngagements)
      .catch(() => {})
  }, [])

  const grouped = React.useMemo(() => {
    const groups: Record<string, Engagement[]> = {}
    for (const e of engagements) {
      const key = e.group || "Other"
      if (!groups[key]) groups[key] = []
      groups[key].push(e)
    }
    const sorted = Object.entries(groups).sort(([a], [b]) => {
      if (a === "Other") return 1
      if (b === "Other") return -1
      return a.localeCompare(b)
    })
    return sorted
  }, [engagements])

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

        {/* Engagements grouped */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="flex items-center justify-between pr-2">
            <span>Engagements</span>
            <CreateEngagementDialog />
          </SidebarGroupLabel>
          <SidebarMenu>
            {grouped.length === 0 && (
              <SidebarMenuItem>
                <SidebarMenuButton className="text-sidebar-foreground/50" disabled>
                  <span>No engagements</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {grouped.map(([groupName, items]) =>
              grouped.length === 1 && groupName === "Other" ? (
                // No grouping needed if everything is ungrouped
                items.map((e) => (
                  <SidebarMenuItem key={e.id}>
                    <SidebarMenuButton render={<a href={`/engagements/${e.id}`} />}>
                      <TargetIcon />
                      <span>{e.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              ) : (
                <Collapsible key={groupName} defaultOpen className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent">
                      <ChevronRightIcon className="size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {groupName}
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenu className="pl-4">
                        {items.map((e) => (
                          <SidebarMenuItem key={e.id}>
                            <SidebarMenuButton render={<a href={`/engagements/${e.id}`} />}>
                              <TargetIcon />
                              <span>{e.name}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              ),
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
