/**
 * Registry of external knowledge sources for ingestion.
 *
 * Only stable technique references belong here. Live data (CVE/NVD/ExploitDB)
 * is searched via tools (searchsploit, nuclei, web search), not ingested.
 */

export interface KnowledgeSource {
  name: string;
  repo: string;
  paths: string[];
  extensions: string[];
  category: string;
  chunkStrategy: "heading" | "file" | "fixed";
  description: string;
}

export const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  {
    name: "PayloadsAllTheThings",
    repo: "https://github.com/swisskyrepo/PayloadsAllTheThings",
    paths: ["."],
    extensions: [".md"],
    category: "techniques",
    chunkStrategy: "heading",
    description: "Technique references for web vulnerabilities, AD, privesc, shells, and more.",
  },
  {
    name: "GTFObins",
    repo: "https://github.com/GTFOBins/GTFOBins.github.io",
    paths: ["_gtfobins"],
    extensions: [],
    category: "privesc",
    chunkStrategy: "file",
    description: "Unix binary exploitation for sudo, SUID, capabilities, and shell escapes.",
  },
  {
    name: "HackTricks",
    repo: "https://github.com/HackTricks-wiki/hacktricks",
    paths: ["."],
    extensions: [".md"],
    category: "techniques",
    chunkStrategy: "heading",
    description: "Pentesting methodology, techniques, and tool usage guides.",
  },
  {
    name: "pk-techniques",
    repo: "",
    paths: ["."],
    extensions: [".md"],
    category: "techniques",
    chunkStrategy: "heading",
    description: "Project-local technique cards for uncommon or engagement-derived patterns.",
  },
];

export function getKnowledgeSource(name: string): KnowledgeSource | undefined {
  return KNOWLEDGE_SOURCES.find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
}
