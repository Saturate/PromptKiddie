/** Canned event sequence based on a real CTF engagement. Used by tests and the UI demo. */
export const DEMO_EVENTS: Array<{ type: string; payload: Record<string, unknown>; delay: number }> = [
  { type: "EngagementStarted", payload: {}, delay: 0 },
  { type: "PortDiscovered", payload: { port: 22, proto: "tcp", service: "ssh", version: "OpenSSH 10.0p2" }, delay: 800 },
  { type: "PortDiscovered", payload: { port: 80, proto: "tcp", service: "http", version: "nginx 1.28.0" }, delay: 200 },
  { type: "PortDiscovered", payload: { port: 1515, proto: "tcp", service: "unknown", version: null }, delay: 200 },
  { type: "VersionIdentified", payload: { product: "nginx", version: "1.28.0", source: "whatweb" }, delay: 1500 },
  { type: "HostnameFound", payload: { hostname: "paperwork.htb", source: "http_redirect", port: 80 }, delay: 500 },
  { type: "VersionIdentified", payload: { product: "Flask", version: null, source: "whatweb" }, delay: 1000 },
  { type: "PathDiscovered", payload: { url: "http://paperwork.htb/download/archive", status: 200, size: 2048 }, delay: 2000 },
  { type: "FileDownloaded", payload: { path: "recon/server.py", type: "python", url: "/download/archive" }, delay: 500 },
  { type: "FindingAdded", payload: { title: "OS Command Injection in LPD J field", severity: "critical", source: "source_code_analysis" }, delay: 2000 },
  { type: "ShellObtained", payload: { user: "lp", method: "command_injection", stable: false }, delay: 3000 },
  { type: "CredentialFound", payload: { username: "root", source: "SCM_RIGHTS FD leak from paperwork-daemon" }, delay: 4000 },
  { type: "ShellObtained", payload: { user: "root", method: "su", stable: true }, delay: 1000 },
  { type: "FlagCaptured", payload: { type: "user", value: "03b8fd38..." }, delay: 500 },
  { type: "FlagCaptured", payload: { type: "root", value: "1544d3d2..." }, delay: 500 },
];
