"""
Temporary Diagnostic Script for MongoDB Atlas Connectivity and TLS Handshake Analysis
Loads .env and executes diagnostic checks matching Backend/app/database.py configuration.
Credentials (username, password, URI) are never printed or exposed.
"""

import sys
import os
import re
import socket
import ssl
import urllib.parse
import urllib.request
import certifi
from pymongo import MongoClient
from pymongo.errors import ServerSelectionTimeoutError, PyMongoError

# Helper to sanitize any credentials from messages or tracebacks
def sanitize_secrets(text: str, uri: str = None) -> str:
    if not text:
        return ""
    # Mask password pattern :password@
    sanitized = re.sub(r':([^@/:]+)@', ':****@', str(text))
    # If full URI is known, replace it
    if uri and uri in sanitized:
        parsed = urllib.parse.urlparse(uri)
        safe_uri = f"{parsed.scheme}://{parsed.username or 'user'}:****@{parsed.hostname}{parsed.path}"
        sanitized = sanitized.replace(uri, safe_uri)
    return sanitized

def run_diagnostics():
    print("=" * 70)
    print("MONGODB ATLAS TLS HANDSHAKE & CONNECTIVITY DIAGNOSTIC REPORT")
    print("=" * 70)

    # 1. Environment & Runtime Information
    print("\n[1] Runtime Environment:")
    print(f"  - Python Version:   {sys.version.split()[0]} ({sys.platform})")
    print(f"  - OpenSSL Version:  {ssl.OPENSSL_VERSION}")
    import pymongo
    print(f"  - PyMongo Version:  {pymongo.__version__}")
    print(f"  - Certifi Version:  {certifi.__version__}")
    print(f"  - Certifi CA Path:  {certifi.where()} (exists: {os.path.exists(certifi.where())})")

    # 2. Public IP Check
    print("\n[2] Active Public IP Address:")
    current_ip = "Unknown"
    for ip_service in ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"]:
        try:
            with urllib.request.urlopen(ip_service, timeout=4) as resp:
                current_ip = resp.read().decode().strip()
                print(f"  - Current outbound public IPv4: {current_ip} (via {ip_service})")
                break
        except Exception:
            continue
    if current_ip == "Unknown":
        print("  - [WARN] Could not retrieve outbound public IP via external HTTP probe.")

    # 3. .env Loading and Variable Verification
    print("\n[3] Environment Variables (.env):")
    from Backend.app.config import settings
    raw_uri = settings.MONGODB_URI
    db_name = settings.MONGODB_DATABASE

    print(f"  - MONGODB_DATABASE: {db_name}")
    print(f"  - MONGODB_URI loaded: {'YES (Non-empty)' if raw_uri else 'NO (Empty)'}")

    if not raw_uri:
        print("\n[CRITICAL ERROR] MONGODB_URI is not set. Aborting test.")
        return False

    # 4. Connection String Format Validation (Zero secret exposure)
    print("\n[4] Connection String Format Inspection:")
    try:
        parsed = urllib.parse.urlparse(raw_uri)
        print(f"  - Scheme:           {parsed.scheme}")
        print(f"  - User specified:   {bool(parsed.username)}")
        print(f"  - Password present: {bool(parsed.password)}")
        print(f"  - Hostname:         {parsed.hostname}")
        print(f"  - Port:             {parsed.port or 'Default SRV'}")
        print(f"  - Path / Database:  {parsed.path}")
        print(f"  - Query Parameters: {parsed.query}")

        is_valid_format = (
            parsed.scheme in ("mongodb+srv", "mongodb")
            and bool(parsed.username)
            and bool(parsed.password)
            and bool(parsed.hostname)
        )
        print(f"  - Format Validation: {'PASS (Valid MongoDB URI format)' if is_valid_format else 'FAIL (Malformed URI)'}")
    except Exception as e:
        print(f"  - URI Parsing Error: {e}")
        return False

    # 5. Low-Level TCP Port Reachability to Shards
    print("\n[5] Low-Level TCP & DNS Resolution Check:")
    # Resolve SRV if mongodb+srv
    shard_nodes = []
    if parsed.scheme == "mongodb+srv":
        import dns.resolver
        try:
            srv_records = dns.resolver.resolve(f"_mongodb._tcp.{parsed.hostname}", "SRV")
            for r in srv_records:
                node = str(r.target).rstrip(".")
                shard_nodes.append((node, r.port))
                print(f"  - Discovered Atlas Shard: {node}:{r.port}")
        except Exception as e:
            print(f"  - DNS SRV lookup note: {e}")
            # Fallback to known shard naming pattern if resolver fails
            shard_nodes = [
                (f"ac-rd0bxc4-shard-00-00.9zivgx1.mongodb.net", 27017),
                (f"ac-rd0bxc4-shard-00-01.9zivgx1.mongodb.net", 27017),
                (f"ac-rd0bxc4-shard-00-02.9zivgx1.mongodb.net", 27017)
            ]
    else:
        shard_nodes = [(parsed.hostname, parsed.port or 27017)]

    # Test TCP connection to each node
    for node, port in shard_nodes:
        try:
            with socket.create_connection((node, port), timeout=3) as s:
                peer = s.getpeername()
                print(f"  - TCP port 27017 to {node}: SUCCESS (Remote IP: {peer[0]})")
        except Exception as e:
            print(f"  - TCP port 27017 to {node}: FAILED ({e})")

    # 6. MongoDB Atlas Client Test (Matching Backend/app/database.py config)
    print("\n[6] Testing Application MongoClient Configuration (tlsCAFile=certifi.where()):")
    client_options = {
        "serverSelectionTimeoutMS": 5000,
        "connectTimeoutMS": 5000,
        "socketTimeoutMS": 10000,
        "tlsCAFile": certifi.where(),
    }
    
    try:
        client = MongoClient(raw_uri, **client_options)
        print("  - Client instantiated. Executing admin 'ping' command...")
        ping_res = client.admin.command("ping")
        print(f"  [SUCCESS] Ping Response: {ping_res}")
        print("  [SUCCESS] MongoDB Atlas TLS handshake succeeded!")
        client.close()
        return True
    except ServerSelectionTimeoutError as e:
        sanitized_msg = sanitize_secrets(str(e), raw_uri)
        print("\n  [FAIL] ServerSelectionTimeoutError during MongoClient ping:")
        print(f"  {sanitized_msg}")
    except PyMongoError as e:
        sanitized_msg = sanitize_secrets(str(e), raw_uri)
        print(f"\n  [FAIL] PyMongoError: {sanitized_msg}")
    except Exception as e:
        sanitized_msg = sanitize_secrets(str(e), raw_uri)
        print(f"\n  [FAIL] Unexpected Error: {type(e).__name__}: {sanitized_msg}")

    # 7. Comparison Test: Using Default System SSL Context (without tlsCAFile)
    print("\n[7] Testing with Default System SSL Context (without explicit tlsCAFile):")
    client_options_default = {
        "serverSelectionTimeoutMS": 5000,
        "connectTimeoutMS": 5000,
        "socketTimeoutMS": 10000,
    }
    try:
        client_def = MongoClient(raw_uri, **client_options_default)
        ping_res = client_def.admin.command("ping")
        print(f"  [SUCCESS] Ping Response: {ping_res}")
        client_def.close()
        return True
    except Exception as e:
        sanitized_msg = sanitize_secrets(str(e), raw_uri)
        print(f"  [FAIL] System SSL Context also failed: {sanitized_msg[:200]}...")

    return False

if __name__ == "__main__":
    success = run_diagnostics()
    sys.exit(0 if success else 1)

