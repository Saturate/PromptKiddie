import { useState, useCallback } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { useTheme } from "@/hooks/use-theme";
import { ConnectionBanner } from "@/components/connection-banner";
import { ChatPanel } from "@/components/chat-panel";
import { Sun, Moon, Monitor, Terminal } from "lucide-react";

const NAV_OPERATE = [
  { to: "/", label: "Dashboard" },
  { to: "/engagements", label: "Engagements" },
];

const NAV_CONFIGURE = [
  { to: "/playbooks", label: "Playbooks" },
  { to: "/knowledge", label: "Knowledge" },
  { to: "/tools", label: "Tools" },
  { to: "/settings", label: "Settings" },
];

const NAV_SYSTEM = [
  { to: "/stats", label: "Stats" },
  { to: "/status", label: "Status" },
];

const THEMES = [
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "system", icon: Monitor, label: "System" },
] as const;

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `block rounded-md px-3 py-1.5 text-sm transition-colors ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-sidebar-foreground hover:bg-sidebar-accent/50"
        }`
      }
    >
      {label}
    </NavLink>
  );
}

export function Layout() {
  const { theme, setTheme } = useTheme();
  const [chatOpen, setChatOpen] = useState(() => {
    const stored = localStorage.getItem("pk-chat-open");
    if (stored !== null) return stored === "true";
    const isHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    return !isHost;
  });

  const toggleChat = useCallback(() => {
    setChatOpen(prev => {
      localStorage.setItem("pk-chat-open", String(!prev));
      return !prev;
    });
  }, []);

  return (
    <div className="flex min-h-screen">
      <nav className="w-52 border-r border-border bg-sidebar px-3 py-4 flex flex-col h-screen sticky top-0">
        <div className="flex items-center gap-2 px-3 mb-5">
          <img src="/favicon.png" alt="" className="size-6" style={{ imageRendering: "pixelated" }} />
          <span className="text-base font-bold text-primary tracking-tight">PK</span>
        </div>

        <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 px-3 mb-1.5">
          Operate
        </div>
        <div className="flex flex-col gap-0.5 mb-3">
          {NAV_OPERATE.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>

        <div className="border-b border-border/30 mb-3" />

        <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 px-3 mb-1.5">
          Configure
        </div>
        <div className="flex flex-col gap-0.5 mb-3">
          {NAV_CONFIGURE.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>

        <div className="border-b border-border/30 mb-3" />

        <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 px-3 mb-1.5">
          System
        </div>
        <div className="flex flex-col gap-0.5">
          {NAV_SYSTEM.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>

        <div className="mt-auto pt-4 space-y-2">
          <button
            onClick={toggleChat}
            className={`flex items-center justify-center w-full gap-1.5 p-1.5 rounded-md text-[10px] font-mono transition-colors ${
              chatOpen ? "bg-pk-amber/10 text-pk-amber" : "text-muted-foreground hover:text-foreground"
            }`}
            title="Toggle chat panel"
          >
            <Terminal className="size-3.5" />
          </button>
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
      <ChatPanel isOpen={chatOpen} onToggle={toggleChat} />
    </div>
  );
}
