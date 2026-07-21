import { PageHeader, SectionLabel } from "@/components/pk";

interface Tool {
  name: string;
  description: string;
  category: "recon" | "enum" | "exploit" | "util" | "infra";
  mcpExposed: boolean;
  binary: string;
  examples: string[];
}

const TOOLS: Tool[] = [
  { name: "RustScan", description: "Fast port scanner. Finds open ports in seconds, then pipes to nmap for service detection.", category: "recon", mcpExposed: true, binary: "rustscan", examples: ["pk exec -- rustscan -a 10.0.0.1 -- -sV -sC", "pk exec -- rustscan -a 10.0.0.0/24 -p 80,443,8080"] },
  { name: "Nmap", description: "Port and service scanner. Service/version detection, OS fingerprinting, NSE scripts.", category: "recon", mcpExposed: true, binary: "nmap", examples: ["pk exec -- nmap -sV -sC -p- 10.0.0.1", "pk exec -- nmap --script vuln 10.0.0.1"] },
  { name: "httpx", description: "HTTP probe for live hosts, tech detection, status codes, and titles.", category: "recon", mcpExposed: true, binary: "httpx-toolkit", examples: ["pk exec -- httpx-toolkit -u https://target.com -tech-detect -status-code -title"] },
  { name: "WhatWeb", description: "Web technology fingerprinter. Identifies CMS, frameworks, server software.", category: "recon", mcpExposed: false, binary: "whatweb", examples: ["pk exec -- whatweb https://target.com --color=never"] },
  { name: "wafw00f", description: "Web Application Firewall detection tool.", category: "recon", mcpExposed: false, binary: "wafw00f", examples: ["pk exec -- wafw00f https://target.com"] },
  { name: "dig", description: "DNS lookup and zone transfer testing.", category: "recon", mcpExposed: true, binary: "dig", examples: ["pk exec -- dig target.com ANY", "pk exec -- dig @ns1.target.com target.com AXFR"] },
  { name: "whois", description: "Domain and IP registration lookup.", category: "recon", mcpExposed: true, binary: "whois", examples: ["pk exec -- whois target.com"] },
  { name: "FFuf", description: "Web fuzzer for directories, vhosts, parameters, and custom wordlists.", category: "enum", mcpExposed: true, binary: "ffuf", examples: ["pk exec -- ffuf -u http://target.com/FUZZ -w /usr/share/wordlists/dirb/common.txt"] },
  { name: "Gobuster", description: "Directory, DNS, and vhost brute-force scanner.", category: "enum", mcpExposed: true, binary: "gobuster", examples: ["pk exec -- gobuster dir -u http://target.com -w /usr/share/wordlists/dirb/common.txt"] },
  { name: "Nikto", description: "Web server vulnerability scanner. Checks for dangerous files, outdated software, misconfigurations.", category: "enum", mcpExposed: true, binary: "nikto", examples: ["pk exec -- nikto -h http://target.com"] },
  { name: "enum4linux", description: "SMB/NetBIOS enumeration. Users, shares, groups, policies.", category: "enum", mcpExposed: false, binary: "enum4linux", examples: ["pk exec -- enum4linux -a 10.0.0.1"] },
  { name: "smbclient", description: "SMB/CIFS file share client. List shares, download files.", category: "enum", mcpExposed: false, binary: "smbclient", examples: ["pk exec -- smbclient -L //10.0.0.1 -N"] },
  { name: "ldapsearch", description: "LDAP directory enumeration. Query Active Directory.", category: "enum", mcpExposed: false, binary: "ldapsearch", examples: ["pk exec -- ldapsearch -x -H ldap://10.0.0.1 -b 'dc=target,dc=com'"] },
  { name: "Nuclei", description: "Template-based vulnerability scanner. CVEs, misconfigs, exposures.", category: "exploit", mcpExposed: true, binary: "nuclei", examples: ["pk exec -- nuclei -u https://target.com -tags cve"] },
  { name: "SQLMap", description: "SQL injection detection and exploitation.", category: "exploit", mcpExposed: true, binary: "sqlmap", examples: ["pk exec -- sqlmap -u 'http://target.com/page?id=1' --batch --dbs"] },
  { name: "Metasploit", description: "Exploitation framework. Exploit modules, payloads, post-exploitation.", category: "exploit", mcpExposed: false, binary: "msfconsole", examples: ["pk exec -- msfconsole -q -x 'use exploit/multi/handler; set PAYLOAD linux/x64/meterpreter/reverse_tcp; set LHOST tun0; run'"] },
  { name: "John the Ripper", description: "Password hash cracker. Supports hundreds of hash formats.", category: "exploit", mcpExposed: false, binary: "john", examples: ["pk exec -- john --wordlist=/usr/share/wordlists/rockyou.txt hashes.txt"] },
  { name: "Hashcat", description: "GPU-accelerated password recovery.", category: "exploit", mcpExposed: false, binary: "hashcat", examples: ["pk exec -- hashcat -m 0 -a 0 hash.txt /usr/share/wordlists/rockyou.txt"] },
  { name: "rustcat", description: "Reverse shell handler and netcat alternative.", category: "exploit", mcpExposed: false, binary: "rcat", examples: ["pk exec -- rcat listen -p 4444"] },
  { name: "Netcat", description: "TCP/UDP networking utility.", category: "exploit", mcpExposed: false, binary: "nc", examples: ["pk exec -- nc -lvnp 4444"] },
  { name: "Impacket", description: "Python toolkit for Windows/AD exploitation. secretsdump, wmiexec, smbexec.", category: "exploit", mcpExposed: false, binary: "impacket-secretsdump", examples: ["pk exec -- impacket-secretsdump DOMAIN/user:pass@10.0.0.1"] },
  { name: "Ncat", description: "Nmap's netcat. SSL support, proxy chaining.", category: "exploit", mcpExposed: false, binary: "ncat", examples: ["pk exec -- ncat -lvnp 4444 --ssl"] },
  { name: "curl", description: "HTTP client. Custom headers, methods, auth, cookies.", category: "util", mcpExposed: false, binary: "curl", examples: ["pk exec -- curl -s -o /dev/null -w '%{http_code}' https://target.com"] },
  { name: "Python 3", description: "Scripting runtime.", category: "util", mcpExposed: false, binary: "python3", examples: ["pk exec -- python3 -c \"import requests; print(requests.get('http://target').status_code)\""] },
  { name: "git", description: "Clone repos, check commit history, find secrets.", category: "util", mcpExposed: false, binary: "git", examples: ["pk exec -- git clone https://github.com/target/repo.git"] },
  { name: "jq", description: "JSON processor. Parse API responses.", category: "util", mcpExposed: false, binary: "jq", examples: ["pk exec -- curl -s http://target/api | jq '.users[].email'"] },
  { name: "ssh / sshpass", description: "SSH client with optional password automation.", category: "util", mcpExposed: false, binary: "ssh", examples: ["pk exec -- sshpass -p 'password' ssh user@10.0.0.1"] },
  { name: "SecLists", description: "Collection of wordlists for fuzzing, passwords, payloads.", category: "util", mcpExposed: false, binary: "/usr/share/seclists", examples: ["/usr/share/seclists/Discovery/Web-Content/directory-list-2.3-medium.txt"] },
  { name: "OpenVPN", description: "VPN client for THM/HTB/remote targets.", category: "infra", mcpExposed: false, binary: "openvpn", examples: ["pk vpn up", "pk vpn status"] },
  { name: "Docker Networks", description: "Isolated networks per engagement.", category: "infra", mcpExposed: true, binary: "docker", examples: ["pk exec -- ip addr show"] },
];

const CATEGORIES: { key: string; label: string; color: string }[] = [
  { key: "recon", label: "Reconnaissance", color: "text-blue-400" },
  { key: "enum", label: "Enumeration", color: "text-purple-400" },
  { key: "exploit", label: "Exploitation", color: "text-red-400" },
  { key: "util", label: "Utilities", color: "text-pk-amber" },
  { key: "infra", label: "Infrastructure", color: "text-zinc-400" },
];

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-2 hover:border-border/80 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm font-semibold">{tool.name}</span>
        <code className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{tool.binary}</code>
        {tool.mcpExposed && (
          <span className="text-[10px] font-mono text-pk-amber bg-pk-amber/10 px-1.5 py-0.5 rounded">MCP</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground font-mono leading-relaxed">{tool.description}</p>
      {tool.examples.length > 0 && (
        <div className="space-y-1">
          {tool.examples.slice(0, 2).map((ex, i) => (
            <div key={i} className="bg-background border border-border rounded px-3 py-1.5 flex items-start gap-1.5">
              <span className="text-pk-amber/50 font-mono text-[11px] select-none shrink-0">$</span>
              <code className="text-foreground font-mono text-[11px] break-all">{ex}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Tools() {
  const mcpCount = TOOLS.filter((t) => t.mcpExposed).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tools"
        subtitle={`${TOOLS.length} tools in the attackbox. ${mcpCount} exposed via MCP.`}
      />

      <div className="border border-pk-amber/20 bg-pk-amber/5 rounded-lg p-4">
        <p className="text-xs font-mono font-semibold">Built on Kali Linux Rolling</p>
        <p className="text-[11px] font-mono text-muted-foreground leading-relaxed mt-1">
          Custom Docker image based on <code className="text-pk-amber/80">kalilinux/kali-rolling</code> with 338+ packages.
          Everything Kali ships is available. Run anything with <code className="text-pk-amber bg-pk-amber/10 px-1 py-0.5 rounded text-[10px]">pk exec</code>.
        </p>
      </div>

      {CATEGORIES.map((cat) => {
        const tools = TOOLS.filter((t) => t.category === cat.key);
        if (tools.length === 0) return null;
        return (
          <section key={cat.key}>
            <div className="flex items-baseline gap-2 mb-3">
              <SectionLabel>{cat.label}</SectionLabel>
              <span className={`font-mono text-[10px] ${cat.color}`}>{tools.length}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {tools.map((tool) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-[10px] text-muted-foreground/50 font-mono text-center py-2">
        if Kali has it, PK has it
      </p>
    </div>
  );
}
