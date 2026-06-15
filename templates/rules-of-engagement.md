# Rules of Engagement: <ENGAGEMENT NAME>

> Phase 0 artifact. **No testing begins until this is complete and authorized.**
> Store the key fields on the `engagements` row; keep this document in the engagement dir.

## Authorization

- **Client / program:** <name>
- **Authorized by:** <name, role> / <email>
- **Authorization reference:** <contract / program URL / ticket>
- **Authorization date:** <YYYY-MM-DD>
- **Engagement type:** ctf | whitebox | blackbox | bugbounty

## Scope

### In scope
- <host / domain / URL / IP range / app / repo>
- ...

### Explicitly out of scope
- <assets, third-party services, prod data, specific techniques>
- ...

## Allowed & disallowed actions

- **Allowed:** <e.g. active scanning, exploitation with PoC, limited privesc>
- **Disallowed:** <e.g. DoS/stress testing, social engineering, data exfiltration,
  destructive actions, pivoting to out-of-scope networks>
- **Data handling:** <how to treat any sensitive data encountered>

## Timing

- **Testing window:** <dates / times / timezone>
- **Blackout periods:** <when NOT to test>

## Communication & escalation

- **Primary contact:** <name> / <phone/email> / <hours>
- **Emergency / "stop testing" contact:** <name> / <phone>
- **Reporting cadence:** <e.g. daily status via inbox; immediate for criticals>

## Sign-off

- Tester: <name> / <date>
- Authorizer: <name> / <date>
