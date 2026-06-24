FROM kalilinux/kali-rolling

RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap ffuf nuclei gobuster nikto sqlmap httpx-toolkit \
    seclists wordlists \
    metasploit-framework \
    enum4linux smbclient ldap-utils \
    john hashcat \
    whatweb wafw00f \
    dnsutils whois curl wget git unzip jq \
    && rm -rf /var/lib/apt/lists/*

# rustscan (not in Kali repos)
RUN ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in amd64) RA=x86_64-linux;; arm64) RA=aarch64-linux;; *) RA=$ARCH;; esac \
    && TAG=$(curl -fsSL https://api.github.com/repos/RustScan/RustScan/releases/latest | jq -r .tag_name) \
    && curl -fsSL "https://github.com/bee-san/RustScan/releases/download/${TAG}/${RA}-rustscan.zip" -o /tmp/rustscan.zip \
    && unzip /tmp/rustscan.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/rustscan && rm /tmp/rustscan.zip

# rustcat (not in Kali repos)
RUN ARCH=$(dpkg --print-architecture) \
    && TAG=$(curl -fsSL https://api.github.com/repos/robiot/rustcat/releases/latest | jq -r .tag_name) \
    && case "$ARCH" in amd64) RC="rustcat-${TAG}-linux-x86_64";; arm64) RC="rustcat-${TAG}-linux-aarch64";; *) RC="rustcat-${TAG}-linux-${ARCH}";; esac \
    && curl -fsSL "https://github.com/robiot/rustcat/releases/download/${TAG}/${RC}.tar.gz" -o /tmp/rustcat.tar.gz \
    && tar xzf /tmp/rustcat.tar.gz -C /usr/local/bin --strip-components=1 \
    && chmod +x /usr/local/bin/rc && rm /tmp/rustcat.tar.gz

WORKDIR /workspace
ENTRYPOINT ["sleep", "infinity"]
