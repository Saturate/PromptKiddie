#!/usr/bin/env tsx
import { CTF_PLAYBOOK, playbookToMarkdown } from "../packages/core/src/playbooks.js";
import { playbookToMarkdown as toMd } from "../packages/core/src/playbook-md.js";

console.log(toMd("CTF Default", CTF_PLAYBOOK));
