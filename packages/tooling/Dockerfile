FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget git unzip jq dnsutils whois \
    nmap libnet-ssleay-perl \
    python3 python3-pip pipx \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/sullo/nikto /opt/nikto \
    && ln -s /opt/nikto/program/nikto.pl /usr/local/bin/nikto \
    && chmod +x /opt/nikto/program/nikto.pl

RUN pipx install sqlmap && pipx ensurepath

# nuclei
RUN ARCH=$(dpkg --print-architecture) \
    && TAG=$(curl -fsSL https://api.github.com/repos/projectdiscovery/nuclei/releases/latest | jq -r .tag_name | tr -d v) \
    && curl -fsSL "https://github.com/projectdiscovery/nuclei/releases/download/v${TAG}/nuclei_${TAG}_linux_${ARCH}.zip" -o /tmp/nuclei.zip \
    && unzip /tmp/nuclei.zip -d /usr/local/bin nuclei \
    && chmod +x /usr/local/bin/nuclei && rm /tmp/nuclei.zip

# ffuf (uses amd64/arm64)
RUN ARCH=$(dpkg --print-architecture) \
    && TAG=$(curl -fsSL https://api.github.com/repos/ffuf/ffuf/releases/latest | jq -r .tag_name | tr -d v) \
    && case "$ARCH" in amd64) FA=amd64;; arm64) FA=arm64;; *) FA=$ARCH;; esac \
    && curl -fsSL "https://github.com/ffuf/ffuf/releases/download/v${TAG}/ffuf_${TAG}_linux_${FA}.tar.gz" -o /tmp/ffuf.tar.gz \
    && tar xzf /tmp/ffuf.tar.gz -C /usr/local/bin ffuf \
    && chmod +x /usr/local/bin/ffuf && rm /tmp/ffuf.tar.gz

# gobuster (uses Linux/arm64 naming)
RUN ARCH=$(dpkg --print-architecture) \
    && TAG=$(curl -fsSL https://api.github.com/repos/OJ/gobuster/releases/latest | jq -r .tag_name | tr -d v) \
    && case "$ARCH" in amd64) GA=x86_64;; arm64) GA=arm64;; *) GA=$ARCH;; esac \
    && curl -fsSL "https://github.com/OJ/gobuster/releases/download/v${TAG}/gobuster_Linux_${GA}.tar.gz" -o /tmp/gobuster.tar.gz \
    && tar xzf /tmp/gobuster.tar.gz -C /usr/local/bin gobuster \
    && chmod +x /usr/local/bin/gobuster && rm /tmp/gobuster.tar.gz

# httpx
RUN ARCH=$(dpkg --print-architecture) \
    && TAG=$(curl -fsSL https://api.github.com/repos/projectdiscovery/httpx/releases/latest | jq -r .tag_name | tr -d v) \
    && curl -fsSL "https://github.com/projectdiscovery/httpx/releases/download/v${TAG}/httpx_${TAG}_linux_${ARCH}.zip" -o /tmp/httpx.zip \
    && unzip /tmp/httpx.zip -d /usr/local/bin httpx \
    && chmod +x /usr/local/bin/httpx && rm /tmp/httpx.zip

# common wordlists
RUN mkdir -p /usr/share/wordlists/dirb \
    && curl -fsSL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/common.txt \
       -o /usr/share/wordlists/dirb/common.txt

ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /workspace
ENTRYPOINT ["sleep", "infinity"]
