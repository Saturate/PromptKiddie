import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";



interface Tool {
  name: string;
  description: string;
  category: "recon" | "enum" | "exploit" | "util" | "infra";
  mcpExposed: boolean;
  binary: string;
  examples: string[];
}

const TOOLS: Tool[] = [
  // --- Recon ---
  {
    name: "RustScan",
    description: "Fast port scanner. Finds open ports in seconds, then pipes to nmap for service detection.",
    category: "recon",
    mcpExposed: true,
    binary: "rustscan",
    examples: [
      "pk exec -- rustscan -a 10.0.0.1 -- -sV -sC",
      "pk exec -- rustscan -a 10.0.0.0/24 -p 80,443,8080",
    ],
  },
  {
    name: "Nmap",
    description: "Port and service scanner. Service/version detection, OS fingerprinting, NSE scripts.",
    category: "recon",
    mcpExposed: true,
    binary: "nmap",
    examples: [
      "pk exec -- nmap -sV -sC -p- 10.0.0.1",
      "pk exec -- nmap -sn 10.0.0.0/24",
      "pk exec -- nmap --script vuln 10.0.0.1",
    ],
  },
  {
    name: "httpx",
    description: "HTTP probe for live hosts, tech detection, status codes, and titles.",
    category: "recon",
    mcpExposed: true,
    binary: "httpx-toolkit",
    examples: [
      "pk exec -- httpx-toolkit -u https://target.com -tech-detect -status-code -title",
    ],
  },
  {
    name: "WhatWeb",
    description: "Web technology fingerprinter. Identifies CMS, frameworks, server software.",
    category: "recon",
    mcpExposed: false,
    binary: "whatweb",
    examples: [
      "pk exec -- whatweb https://target.com --color=never",
    ],
  },
  {
    name: "wafw00f",
    description: "Web Application Firewall detection tool.",
    category: "recon",
    mcpExposed: false,
    binary: "wafw00f",
    examples: [
      "pk exec -- wafw00f https://target.com",
    ],
  },
  {
    name: "dig",
    description: "DNS lookup and zone transfer testing.",
    category: "recon",
    mcpExposed: true,
    binary: "dig",
    examples: [
      "pk exec -- dig target.com ANY",
      "pk exec -- dig @ns1.target.com target.com AXFR",
    ],
  },
  {
    name: "whois",
    description: "Domain and IP registration lookup.",
    category: "recon",
    mcpExposed: true,
    binary: "whois",
    examples: ["pk exec -- whois target.com"],
  },

  // --- Enumeration ---
  {
    name: "FFuf",
    description: "Web fuzzer for directories, vhosts, parameters, and custom wordlists.",
    category: "enum",
    mcpExposed: true,
    binary: "ffuf",
    examples: [
      "pk exec -- ffuf -u http://target.com/FUZZ -w /usr/share/wordlists/dirb/common.txt",
      "pk exec -- ffuf -u http://target.com -H 'Host: FUZZ.target.com' -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt",
    ],
  },
  {
    name: "Gobuster",
    description: "Directory, DNS, and vhost brute-force scanner.",
    category: "enum",
    mcpExposed: true,
    binary: "gobuster",
    examples: [
      "pk exec -- gobuster dir -u http://target.com -w /usr/share/wordlists/dirb/common.txt",
      "pk exec -- gobuster dns -d target.com -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt",
    ],
  },
  {
    name: "Nikto",
    description: "Web server vulnerability scanner. Checks for dangerous files, outdated software, misconfigurations.",
    category: "enum",
    mcpExposed: true,
    binary: "nikto",
    examples: [
      "pk exec -- nikto -h http://target.com",
      "pk exec -- nikto -h http://target.com -port 8080 -Tuning x",
    ],
  },
  {
    name: "enum4linux",
    description: "SMB/NetBIOS enumeration. Users, shares, groups, policies from Windows/Samba targets.",
    category: "enum",
    mcpExposed: false,
    binary: "enum4linux",
    examples: [
      "pk exec -- enum4linux -a 10.0.0.1",
    ],
  },
  {
    name: "smbclient",
    description: "SMB/CIFS file share client. List shares, download files, interact with Windows shares.",
    category: "enum",
    mcpExposed: false,
    binary: "smbclient",
    examples: [
      "pk exec -- smbclient -L //10.0.0.1 -N",
      "pk exec -- smbclient //10.0.0.1/share -U user%password",
    ],
  },
  {
    name: "ldapsearch",
    description: "LDAP directory enumeration. Query Active Directory for users, groups, policies.",
    category: "enum",
    mcpExposed: false,
    binary: "ldapsearch",
    examples: [
      "pk exec -- ldapsearch -x -H ldap://10.0.0.1 -b 'dc=target,dc=com'",
    ],
  },

  // --- Exploitation ---
  {
    name: "Nuclei",
    description: "Template-based vulnerability scanner. Thousands of community templates for CVEs, misconfigs, exposures.",
    category: "exploit",
    mcpExposed: true,
    binary: "nuclei",
    examples: [
      "pk exec -- nuclei -u https://target.com -tags cve",
      "pk exec -- nuclei -u https://target.com -tags misconfig,exposure",
    ],
  },
  {
    name: "SQLMap",
    description: "SQL injection detection and exploitation. Database enumeration, data extraction, OS shell.",
    category: "exploit",
    mcpExposed: true,
    binary: "sqlmap",
    examples: [
      "pk exec -- sqlmap -u 'http://target.com/page?id=1' --batch --dbs",
      "pk exec -- sqlmap -u 'http://target.com/login' --data 'user=a&pass=b' --batch",
    ],
  },
  {
    name: "Metasploit",
    description: "Exploitation framework. Exploit modules, payloads, post-exploitation, pivoting.",
    category: "exploit",
    mcpExposed: false,
    binary: "msfconsole",
    examples: [
      "pk exec -- msfconsole -q -x 'use exploit/multi/handler; set PAYLOAD linux/x64/meterpreter/reverse_tcp; set LHOST tun0; run'",
    ],
  },
  {
    name: "John the Ripper",
    description: "Password hash cracker. Supports hundreds of hash formats.",
    category: "exploit",
    mcpExposed: false,
    binary: "john",
    examples: [
      "pk exec -- john --wordlist=/usr/share/wordlists/rockyou.txt hashes.txt",
      "pk exec -- john --show hashes.txt",
    ],
  },
  {
    name: "Hashcat",
    description: "GPU-accelerated password recovery. Rule-based and mask attacks.",
    category: "exploit",
    mcpExposed: false,
    binary: "hashcat",
    examples: [
      "pk exec -- hashcat -m 0 -a 0 hash.txt /usr/share/wordlists/rockyou.txt",
    ],
  },
  {
    name: "rustcat (rcat)",
    description: "Reverse shell handler and netcat alternative. Listener for callbacks.",
    category: "exploit",
    mcpExposed: false,
    binary: "rcat",
    examples: [
      "pk exec -- rcat listen -p 4444",
    ],
  },
  {
    name: "Netcat",
    description: "TCP/UDP networking utility. Port scanning, file transfer, reverse shells.",
    category: "exploit",
    mcpExposed: false,
    binary: "nc",
    examples: [
      "pk exec -- nc -lvnp 4444",
      "pk exec -- nc -zv 10.0.0.1 1-1000",
    ],
  },

  {
    name: "Impacket",
    description: "Python toolkit for Windows/AD exploitation. secretsdump, wmiexec, smbexec, psexec, rpcdump, samrdump, netview. The go-to for Active Directory attacks.",
    category: "exploit",
    mcpExposed: false,
    binary: "impacket-secretsdump",
    examples: [
      "pk exec -- impacket-secretsdump DOMAIN/user:pass@10.0.0.1",
      "pk exec -- impacket-wmiexec DOMAIN/admin:pass@10.0.0.1",
      "pk exec -- impacket-rpcdump 10.0.0.1",
    ],
  },
  {
    name: "Ncat",
    description: "Nmap's netcat. SSL support, proxy chaining, connection brokering.",
    category: "exploit",
    mcpExposed: false,
    binary: "ncat",
    examples: [
      "pk exec -- ncat -lvnp 4444 --ssl",
    ],
  },

  // --- Utilities ---
  {
    name: "curl",
    description: "HTTP client. Custom headers, methods, auth, cookies, proxies.",
    category: "util",
    mcpExposed: false,
    binary: "curl",
    examples: [
      "pk exec -- curl -s -o /dev/null -w '%{http_code}' https://target.com",
      "pk exec -- curl -X POST -d '{\"user\":\"admin\"}' -H 'Content-Type: application/json' http://target.com/api",
    ],
  },
  {
    name: "wget",
    description: "File downloader and website mirroring.",
    category: "util",
    mcpExposed: false,
    binary: "wget",
    examples: [
      "pk exec -- wget -r -l 2 http://target.com",
    ],
  },
  {
    name: "Python 3",
    description: "Scripting runtime. Write custom exploits, parse output, automate multi-step attacks.",
    category: "util",
    mcpExposed: false,
    binary: "python3",
    examples: [
      "pk exec -- python3 -c \"import requests; print(requests.get('http://target').status_code)\"",
    ],
  },
  {
    name: "Ruby",
    description: "Scripting runtime. Required by Metasploit modules and custom exploit development.",
    category: "util",
    mcpExposed: false,
    binary: "ruby",
    examples: [
      "pk exec -- ruby -e 'puts \"test\"'",
    ],
  },
  {
    name: "Perl",
    description: "Scripting runtime. Many legacy exploit scripts and one-liners.",
    category: "util",
    mcpExposed: false,
    binary: "perl",
    examples: [
      "pk exec -- perl -e 'print \"A\"x100'",
    ],
  },
  {
    name: "git",
    description: "Clone repos, check commit history, find secrets in git log.",
    category: "util",
    mcpExposed: false,
    binary: "git",
    examples: [
      "pk exec -- git clone https://github.com/target/repo.git",
      "pk exec -- git log --oneline --all",
    ],
  },
  {
    name: "jq",
    description: "JSON processor. Parse API responses, extract fields from scan output.",
    category: "util",
    mcpExposed: false,
    binary: "jq",
    examples: [
      "pk exec -- curl -s http://target/api | jq '.users[].email'",
    ],
  },
  {
    name: "ssh / sshpass",
    description: "SSH client with optional password automation for scripted access.",
    category: "util",
    mcpExposed: false,
    binary: "ssh",
    examples: [
      "pk exec -- sshpass -p 'password' ssh user@10.0.0.1",
      "pk exec -- ssh -i key.pem user@10.0.0.1",
    ],
  },
  {
    name: "SecLists",
    description: "Collection of wordlists for fuzzing, passwords, usernames, payloads, web shells.",
    category: "util",
    mcpExposed: false,
    binary: "/usr/share/seclists",
    examples: [
      "/usr/share/seclists/Discovery/Web-Content/directory-list-2.3-medium.txt",
      "/usr/share/seclists/Passwords/Common-Credentials/10-million-password-list-top-1000.txt",
      "/usr/share/seclists/Fuzzing/LFI/LFI-gracefulsecurity-linux.txt",
      "/usr/share/seclists/Web-Shells/",
    ],
  },
  {
    name: "Wordlists",
    description: "Kali default wordlists including rockyou.txt, nmap scripts, john, sqlmap.",
    category: "util",
    mcpExposed: false,
    binary: "/usr/share/wordlists",
    examples: [
      "/usr/share/wordlists/rockyou.txt.gz",
      "/usr/share/wordlists/nmap.lst",
    ],
  },

  // --- Infrastructure ---
  {
    name: "OpenVPN",
    description: "VPN client for THM/HTB/remote targets. Config at /vpn/config.ovpn.",
    category: "infra",
    mcpExposed: false,
    binary: "openvpn",
    examples: [
      "pk vpn up",
      "pk vpn status",
      "pk vpn down",
    ],
  },
  {
    name: "Docker Networks",
    description: "Isolated networks per engagement. Auto-connects the tooling container.",
    category: "infra",
    mcpExposed: true,
    binary: "docker",
    examples: [
      "pk exec -- ip addr show",
    ],
  },
];

const categoryMeta: Record<string, { label: string; color: string; description: string }> = {
  recon: {
    label: "Reconnaissance",
    color: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    description: "Map the attack surface. Discover hosts, ports, services, and technologies.",
  },
  enum: {
    label: "Enumeration",
    color: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    description: "Deepen knowledge. Fuzz directories, enumerate shares, query LDAP.",
  },
  exploit: {
    label: "Exploitation",
    color: "bg-red-500/15 text-red-400 border-red-500/30",
    description: "Validate vulnerabilities. Scan for CVEs, crack passwords, pop shells.",
  },
  util: {
    label: "Utilities",
    color: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    description: "Supporting tools. HTTP clients, wordlists, file transfer.",
  },
  infra: {
    label: "Infrastructure",
    color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    description: "VPN, networking, container management.",
  },
};

const categories = ["recon", "enum", "exploit", "util", "infra"] as const;

export default function Tools() {
  const mcpCount = TOOLS.filter((t) => t.mcpExposed).length;
  const totalCount = TOOLS.length;

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold font-mono">Tools</h1>
        <p className="text-sm text-muted-foreground font-mono">
          {totalCount} tools in the attackbox. {mcpCount} exposed via MCP, all available through{" "}
          <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">pk exec</code>.
        </p>
      </div>

      {/* Platform callout */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-4 pb-4 px-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px] space-y-1">
              <p className="text-xs font-mono font-semibold text-foreground">
                Built on Kali Linux Rolling
              </p>
              <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                The PK attackbox is a custom Docker image based on{" "}
                <code className="text-primary/80">kalilinux/kali-rolling</code> with 338+ packages.
                Everything Kali ships is available, plus RustScan, rustcat, and the full SecLists collection.
                The tools below are the ones PK uses most; run anything else with{" "}
                <code className="text-primary bg-primary/10 px-1 py-0.5 rounded text-[10px]">pk exec</code>.
              </p>
            </div>
            <div className="flex flex-col gap-1 text-[10px] font-mono text-muted-foreground shrink-0">
              <span>338+ packages</span>
              <span>Metasploit Framework</span>
              <span>Impacket Suite</span>
              <span>SecLists + rockyou</span>
              <span>Python 3 / Ruby / Perl</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {categories.map((cat) => {
          const meta = categoryMeta[cat];
          const count = TOOLS.filter((t) => t.category === cat).length;
          return (
            <Card key={cat} className="@container/card">
              <CardContent className="pt-4 pb-3 px-4">
                <Badge className={`font-mono text-[10px] border ${meta.color} mb-2`}>
                  {meta.label}
                </Badge>
                <p className="text-2xl font-bold font-mono tabular-nums">{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Tool listing by category */}
      {categories.map((cat) => {
        const meta = categoryMeta[cat];
        const tools = TOOLS.filter((t) => t.category === cat);
        return (
          <Card key={cat}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-sm font-mono">{meta.label}</CardTitle>
                <Badge className={`font-mono text-[10px] border ${meta.color}`}>
                  {tools.length}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono">{meta.description}</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {tools.map((tool) => (
                  <div key={tool.name} className="border border-border rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-foreground">{tool.name}</span>
                      <code className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {tool.binary}
                      </code>
                      {tool.mcpExposed && (
                        <Badge className="font-mono text-[10px] bg-primary/10 text-primary border-primary/30 border">
                          MCP
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono leading-relaxed">
                      {tool.description}
                    </p>
                    <div className="space-y-1">
                      {tool.examples.map((ex, i) => (
                        <div key={i} className="bg-background border border-border rounded px-3 py-1.5 flex items-start gap-1.5">
                          <span className="text-primary/50 font-mono text-[11px] select-none shrink-0">$</span>
                          <code className="text-foreground font-mono text-[11px] break-all">{ex}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <div className="text-center py-4 space-y-2">
        <p className="text-xs text-muted-foreground font-mono">
          This page lists PK&apos;s most-used tools. The attackbox has 338+ Kali packages installed.
        </p>
        <p className="text-xs text-muted-foreground font-mono">
          Need something not listed? <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[10px]">pk exec -- &lt;command&gt;</code> runs anything in the container.
          Missing a package? <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[10px]">pk exec -- apt-get install &lt;package&gt;</code>
        </p>
        <p className="text-[10px] text-primary/40 italic font-mono">if Kali has it, PK has it</p>
      </div>
    </div>
  );
}
