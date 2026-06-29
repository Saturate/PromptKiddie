---
name: verification
description: >-
  Adversarial finding verification — assume each finding is WRONG until proven otherwise.
  Spawns a skeptic pass per finding to confirm or reject it with evidence.
  Use after exploitation to filter false positives before reporting.
---

# Adversarial Finding Verification

After exploitation produces findings, verify each one adversarially. The verifier's job is
to **disprove** the finding, not confirm it. Only findings that survive skeptical review
reach the report.

Adapted from Visa's VVAH adversarial verification pattern (Apache-2.0).

## When to use

- After the exploit phase produces triage/confirmed findings
- Before the reporting phase
- When finding quality matters more than speed

## Procedure

For each finding in the engagement:

1. **Load the finding** from the database: `pk finding list`
2. **Attempt to disprove it.** For each finding, work through these steps:

   **A. Verify the claim.** Re-run the exploit or check the evidence. Does it actually
   demonstrate what the finding says? A screenshot of a 200 response is not proof of SQLi.

   **B. Check for mitigations.** Look for upstream defenses the initial scan may have missed:
   WAF rules, input validation, rate limiting, auth gates, network segmentation.

   **C. Assess reachability.** Can an external or lower-privileged attacker actually reach
   this code path? Internal-only endpoints behind VPN are a different severity than
   internet-facing ones.

   **D. Verify impact.** Is the impact real and concrete, or hypothetical? "Could
   potentially lead to RCE" is not a finding. "Injecting `; id` returns `uid=0(root)`" is.

3. **Render a verdict:**
   - `true_positive` — verified with evidence, reachable, no mitigation found
   - `false_positive` — mitigated, unreachable, or the evidence doesn't support the claim

4. **Update the finding:**
   ```bash
   pk finding update <id> --verdict true_positive --verdict-confidence 8 \
     --verdict-reason "Confirmed: SQLi on /login returns DB version via error-based injection"
   ```
   Or:
   ```bash
   pk finding update <id> --verdict false_positive --verdict-confidence 9 \
     --verdict-reason "WAF blocks all union-based payloads; error-based returns generic 500"
   ```

5. **Log the verification activity:**
   ```bash
   pk activity log --phase exploit \
     --action "Verified finding <id>: TRUE_POSITIVE (8/10) - confirmed SQLi"
   ```

## Exclusion rules (do NOT report)

**A. No real attacker**
- Code unreachable in production: test fixtures, dead branches, build scripts
- Inputs settable only by someone with existing shell/deploy access to the same host

**B. No security impact**
- Crashes from bad config that don't expose data or grant access
- Functionality working as designed

**C. Wrong layer**
- Server-side bug classes raised against pure client code
- Memory corruption in managed languages without native bindings

**D. Handled elsewhere**
- Vulnerable library versions (SCA pipeline, not pentest)
- Pure volumetric DoS (infra concern)

**E. Noise floor**
- Log injection with no downstream parser
- Best-practice gaps with no demonstrated exploit path

## Self-verification gate

Every finding must pass all five checks or be dropped:

1. **REACHABLE** — An external or lower-privileged caller can hit this path
2. **UNMITIGATED** — No control between source and sink neutralizes it
3. **CONCRETE** — You can state the exact payload and effect in one sentence
4. **IN SCOPE** — Doesn't match exclusion groups A-E
5. **EVIDENCED** — Proof captured via `pk evidence add`

## Severity calibration

Rate the exploit, not the bug class. "SQL injection" is not a severity.

**Step 1:** Write down preconditions, access level, and blast radius.
**Step 2:** Map to tier:
- HIGH: no auth / low-priv session, zero-one preconditions, impact is RCE / auth bypass / bulk data exposure
- MEDIUM: needs valid session or couple of preconditions, scoped impact
- LOW: three+ preconditions, local/adjacent access, limited availability impact

**Step 3:** Downgrade triggers:
- Test/example/debug code: drop one tier
- Requires second independent vuln: drop one tier
- Can't decide between tiers: pick the lower one

## Output

After verification, the engagement should have:
- Each finding marked `true_positive` or `false_positive` with confidence and reason
- Updated severity based on calibration
- Activity log entries for each verification
- Only `true_positive` findings proceed to the reporting phase
