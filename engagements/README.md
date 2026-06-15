# engagements/

On-disk evidence and working files, one directory per engagement:

```
engagements/<engagement-slug>/
  rules-of-engagement.md   # the signed RoE (from templates/)
  recon/                   # nmap, subfinder, httpx output
  enum/                    # ffuf, nuclei, enum output
  exploit/                 # PoCs, shell logs, screenshots
  loot/                    # downloaded files (handle per RoE data rules)
  report/                  # generated write-up
```

**This directory is gitignored** (except this README and `.gitkeep`). Never commit
target/client data. Register artifacts with `pk evidence add` so they are hashed and linked
to the engagement in the database.
