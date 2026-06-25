FROM kalilinux/kali-rolling

RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap ncat netcat-traditional ffuf nuclei gobuster nikto sqlmap httpx-toolkit \
    seclists wordlists \
    metasploit-framework \
    enum4linux smbclient ldap-utils \
    john hashcat \
    whatweb wafw00f \
    dnsutils whois curl wget git unzip jq \
    openvpn iproute2 iputils-ping \
    && rm -rf /var/lib/apt/lists/*

# rustcat (build from source - no arm64 binary available)
RUN apt-get update && apt-get install -y --no-install-recommends cargo rustc \
    && cargo install rustcat \
    && cp /root/.cargo/bin/rcat /usr/local/bin/rcat \
    && apt-get purge -y cargo rustc && apt-get autoremove -y \
    && rm -rf /root/.cargo /var/lib/apt/lists/*

# rustscan (not in Kali repos)
RUN ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in amd64) RA=x86_64-linux;; arm64) RA=aarch64-linux;; *) RA=$ARCH;; esac \
    && TAG=$(curl -fsSL https://api.github.com/repos/RustScan/RustScan/releases/latest | jq -r .tag_name) \
    && curl -fsSL "https://github.com/bee-san/RustScan/releases/download/${TAG}/${RA}-rustscan.zip" -o /tmp/rustscan.zip \
    && unzip /tmp/rustscan.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/rustscan && rm /tmp/rustscan.zip

# Entrypoint: start OpenVPN if config is mounted, then sleep
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]
