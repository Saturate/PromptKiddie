# ADCS Dangling Published Templates

## When to use

- Active Directory Certificate Services (ADCS) environment
- You have CreateChild permission on the Certificate Templates container
- The CA publishes template names that have no matching object in the container
- Goal: create an ESC1-vulnerable template that the CA already trusts

## Tags

- ATT&CK: T1649 (Steal or Forge Authentication Certificates)
- Platform: Windows, Active Directory
- Services: AD CS, Certificate Authority
- Privileges: CreateChild on CN=Certificate Templates,CN=Public Key Services

## How it works

A CA publishes templates by listing names in its `certificateTemplates` attribute.
These names reference objects in `CN=Certificate Templates,CN=Public Key Services`.
If a published name has no matching object (deleted, never created, or name mismatch),
the CA still advertises it but enrollment fails. An attacker with CreateChild on the
container can create a template with that exact name, configure it as ESC1-vulnerable,
and request a certificate as any user.

## Detection

```bash
# Published templates on the CA
certipy find -u user@domain -p pass -dc-ip <DC> -stdout | grep "Template Name"

# Actual template objects
ldapsearch -H ldap://<DC> \
  -b "CN=Certificate Templates,CN=Public Key Services,CN=Services,CN=Configuration,DC=domain,DC=htb" \
  "(objectClass=pKICertificateTemplate)" cn
```

Any published name without a matching object is a dangling template.

## Exploitation

1. Create a template object matching the dangling name
2. Set `msPKI-Certificate-Name-Flag = 1` (CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT)
3. Set EKU to Client Authentication
4. Grant enrollment to Domain Users (or your controlled account)
5. Request a certificate with any UPN

```bash
certipy req -u attacker@domain -p pass -ca <CA-NAME> \
  -template <phantom-template> -upn administrator@domain -dc-ip <DC>
```

## Operational notes

**Certipy and Certify miss this entirely.** Both tools only audit existing template
objects for ESC1-ESC8 misconfigs. Neither compares the CA's published list against
the template container. Manual comparison is required.

**Look for dangling ACEs.** Deleted AD groups whose SIDs still appear in the
Certificate Templates container ACL may grant CreateChild to accounts that inherited
the deleted group's memberships.

**Box indicators.** Engagement names referencing "dangling" or "phantom", deleted PKI
admin groups (Template_Editors, Cert_Managers), or `certutil -CATemplates` showing
templates certipy can't find.

## Proven on

- Windows Server 2025 DC (HTB DanglingTree, 2026-08-13): deleted DevOps_PKI group left dangling SID with CreateChild; published template name had no matching object
