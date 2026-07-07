#!/usr/bin/env python3
"""Send a JSON request to a gleipnir relay Unix socket and print the response."""
import socket
import sys

sock_path = sys.argv[1]
request = sys.argv[2]

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(30)
s.connect(sock_path)
s.sendall((request + "\n").encode())

# Read until we get a complete JSON line (newline-terminated response)
data = b""
while True:
    try:
        chunk = s.recv(65536)
    except socket.timeout:
        break
    if not chunk:
        break
    data += chunk
    if b"\n" in data:
        break

s.close()
sys.stdout.write(data.decode())
