# Hash cracking

## In-container cracking (CPU)

The attackbox includes `john` and `hashcat`. CPU cracking is fine for weak hashes or
small wordlists but is orders of magnitude slower than GPU cracking for bcrypt, PBKDF2,
or large wordlists.

```bash
# Identify hash type
pk exec -- hashid <hash>

# John with trimmed wordlist
pk exec -- john --wordlist=/tmp/trimmed.txt /tmp/hashes.txt

# Hashcat (CPU, forced)
pk exec -- hashcat -m <mode> /tmp/hashes.txt /tmp/trimmed.txt --force
```

## Host GPU cracking

For serious cracking (bcrypt, PBKDF2, large wordlists), use the host machine's GPU.
The attackbox container does not have GPU passthrough.

### Manual path

1. Copy the hash file out of the container:
   ```bash
   docker cp promptkiddie-attackbox:/tmp/hashes.txt ./hashes.txt
   ```

2. Run hashcat on the host with GPU:
   ```bash
   hashcat -m <mode> -a 0 ./hashes.txt /path/to/wordlist.txt
   ```

3. Copy results back and register as evidence:
   ```bash
   docker cp ./hashcat.potfile promptkiddie-attackbox:/tmp/
   pk evidence add --path /tmp/hashcat.potfile --type output
   ```

### Common hash modes

| Hash type | hashcat -m | Notes |
|-----------|-----------|-------|
| NTLM | 1000 | Fast; try online lookup first (ntlm.pw) |
| NTLMv2 | 5600 | Captured from Responder/relay |
| MD5 | 0 | Try online lookup first |
| SHA1 | 100 | Try online lookup first |
| bcrypt | 3200 | Slow; trim wordlist aggressively |
| PBKDF2-SHA256 | 10900 | Slow; trim wordlist by password policy |
| Kerberoast (RC4) | 13100 | |
| Kerberoast (AES) | 19700 | |
| AS-REP | 18200 | |

## Optimization fast-path

Before cracking, always optimize:

1. **Check password policy.** If a minimum length is known (e.g. 20+ chars), trim:
   ```bash
   grep -E '^.{20,}$' /usr/share/wordlists/rockyou.txt > /tmp/trimmed.txt
   ```
   A 20-char minimum reduces rockyou from 14M entries to ~46K.

2. **Online lookups** for unsalted hashes (NTLM, MD5, SHA1):
   ```bash
   curl -s "https://ntlm.pw/<hash>"
   ```

3. **CeWL wordlist** from the target's web content:
   ```bash
   cewl http://TARGET -d 2 -m 5 -w /tmp/cewl.txt
   ```

4. **Rule-based mutations** instead of larger wordlists:
   ```bash
   hashcat -m <mode> /tmp/hashes.txt /tmp/trimmed.txt -r /usr/share/hashcat/rules/best64.rule
   ```
