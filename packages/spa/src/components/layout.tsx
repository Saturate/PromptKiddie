import { Outlet, NavLink } from "react-router-dom";
import { useTheme } from "@/hooks/use-theme";
import { ConnectionBanner } from "@/components/connection-banner";
import { Sun, Moon, Monitor } from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/engagements", label: "Engagements" },
  { to: "/playbooks", label: "Playbooks" },
  { to: "/chat", label: "Chat" },
  { to: "/knowledge", label: "Knowledge" },
  { to: "/tools", label: "Tools" },
  { to: "/stats", label: "Stats" },
  { to: "/settings", label: "Settings" },
];

const THEMES = [
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "system", icon: Monitor, label: "System" },
] as const;

export function Layout() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex min-h-screen">
      <nav className="w-56 border-r border-border bg-sidebar p-4 flex flex-col gap-1 h-screen sticky top-0">
        <div className="mb-4 text-lg font-bold text-primary">PK</div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `block rounded-md px-3 py-2 text-sm ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
        <div className="mt-auto pt-4">
          <div className="flex items-center gap-0.5 bg-sidebar-accent/50 rounded-lg p-0.5">
            {THEMES.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex items-center justify-center flex-1 p-1.5 rounded-md transition-colors ${
                  theme === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title={label}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
        </div>
      </nav>
      <main className="flex-1 p-6 overflow-auto">
        <ConnectionBanner />
        <Outlet />
      </main>
    </div>
  );
}
