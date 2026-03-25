#!/usr/bin/env python3
"""
Diagnostic script: tests the full PACS C-FIND query pipeline via Orthanc
and prints the raw response structure so we can see what field names to use.

Usage:
    python test_pacs_query.py

Orthanc must be running at localhost:8042.
The "remote" PACS is also Orthanc at localhost, AET=ORTHANC, port=4242.
"""

import json
import sys
import urllib.request
import urllib.error

ORTHANC = "http://localhost:8042"
REMOTE_AET  = "ORTHANC"
REMOTE_HOST = "127.0.0.1"
REMOTE_PORT = 4242
MODALITY_NAME = "test_pacs"


def get(path):
    url = ORTHANC + path
    try:
        with urllib.request.urlopen(url) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code} on GET {path}: {e.read().decode()[:400]}")
        return None
    except Exception as e:
        print(f"  Error on GET {path}: {e}")
        return None


def post(path, body):
    url = ORTHANC + path
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data,
                                  headers={"Content-Type": "application/json"},
                                  method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code} on POST {path}: {e.read().decode()[:400]}")
        return None
    except Exception as e:
        print(f"  Error on POST {path}: {e}")
        return None


def put(path, body):
    url = ORTHANC + path
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data,
                                  headers={"Content-Type": "application/json"},
                                  method="PUT")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code} on PUT {path}: {e.read().decode()[:400]}")
        return None
    except Exception as e:
        print(f"  Error on PUT {path}: {e}")
        return None


def section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


# ── Step 0: verify Orthanc is up ─────────────────────────────────────────────
section("0. Orthanc system info")
sys_info = get("/system")
if sys_info is None:
    print("ERROR: Orthanc is not reachable at", ORTHANC)
    sys.exit(1)
print(f"  Version : {sys_info.get('Version','?')}")
print(f"  Name    : {sys_info.get('Name','?')}")

# ── Step 1: how many studies are in local Orthanc? ───────────────────────────
section("1. Local studies in Orthanc")
local_studies = get("/studies")
if not local_studies:
    print("  No studies in local Orthanc.")
else:
    print(f"  {len(local_studies)} study/studies: {local_studies}")
    # Show one study's metadata shape
    s = get(f"/studies/{local_studies[0]}")
    print(f"\n  Example study structure (first study):")
    print(json.dumps(s, indent=4)[:2000])

# ── Step 2: register the modality ───────────────────────────────────────────
section(f"2. Register modality '{MODALITY_NAME}' -> {REMOTE_AET}@{REMOTE_HOST}:{REMOTE_PORT}")
mod_result = put(f"/modalities/{MODALITY_NAME}", {
    "AET": REMOTE_AET,
    "Host": REMOTE_HOST,
    "Port": REMOTE_PORT,
    "AllowEcho": True,
    "AllowFind": True,
    "AllowMove": True,
})
print(f"  Result: {mod_result}")

# ── Step 3: C-ECHO to make sure we can reach the modality ───────────────────
section(f"3. C-ECHO to {REMOTE_AET}")
echo_result = post(f"/modalities/{MODALITY_NAME}/echo", {})
print(f"  Result: {echo_result}")

# ── Step 4: C-FIND ──────────────────────────────────────────────────────────
section("4. C-FIND (all studies)")
find_body = {
    "Level": "Study",
    "Query": {
        "PatientName": "",
        "StudyDescription": "",
        "StudyDate": "",
        "ModalitiesInStudy": "",
        "StudyInstanceUID": "",
        "Modality": "",
        "PatientID": "",
    }
}
find_result = post(f"/modalities/{MODALITY_NAME}/query", find_body)
print(f"  Raw result: {json.dumps(find_result, indent=4)}")

if find_result is None or "ID" not in find_result:
    print("  ERROR: No query ID returned!")
    sys.exit(1)

query_id = find_result["ID"]
print(f"\n  Query ID: {query_id}")

# ── Step 5: get answer indices ───────────────────────────────────────────────
section("5. Answer indices")
indices = get(f"/queries/{query_id}/answers")
print(f"  Raw indices: {indices}")
print(f"  Type of first index: {type(indices[0]).__name__ if indices else 'N/A'}")

if not indices:
    print("\n  No answers returned from C-FIND (empty study list on remote PACS?)")
    sys.exit(0)

# ── Step 6: get each answer's content ───────────────────────────────────────
section("6. Answer content (raw DICOM JSON from Orthanc)")
for idx in indices[:5]:  # show at most 5
    print(f"\n  ── Answer {idx} ──")
    content = get(f"/queries/{query_id}/answers/{idx}/content")
    print(json.dumps(content, indent=4))

# ── Step 7: try ?expand endpoint for comparison ──────────────────────────────
section("7. /answers?expand (alternate approach)")
expanded = get(f"/queries/{query_id}/answers?expand")
if expanded:
    print(json.dumps(expanded[:2] if isinstance(expanded, list) else expanded, indent=4))
else:
    print("  (not supported or empty)")

# ── Step 8: extract fields manually to show what the Rust code should see ───
section("8. Extracted study metadata")
all_studies = []
for idx in indices:
    content = get(f"/queries/{query_id}/answers/{idx}/content")
    if content is None:
        continue

    def extract(content, friendly, hex_tag):
        """
        Mirrors the fixed Rust str_field() logic.
        Orthanc C-FIND returns: { "0010,0010": { "Name": "PatientName", "Type": "String", "Value": "SMITH^JOHN" } }
        Note: "Value" is a plain string (not array), hex tags are lowercase.
        """
        def from_node(node):
            if isinstance(node, str):
                return node.strip()
            if isinstance(node, dict):
                # Orthanc proprietary: Value is a plain string
                val = node.get("Value")
                if isinstance(val, str) and val:
                    return val.strip()
                # PN Alphabetic
                if "Alphabetic" in node:
                    return node["Alphabetic"].strip()
                # DICOM JSON array
                if isinstance(val, list) and val:
                    if isinstance(val[0], str):
                        return val[0].strip()
                    if isinstance(val[0], dict) and "Alphabetic" in val[0]:
                        return val[0]["Alphabetic"].strip()
            return None

        for key in [friendly, hex_tag, hex_tag.lower()]:
            node = content.get(key)
            if node is not None:
                result = from_node(node)
                if result is not None:
                    return result
        return ""

    patient_name      = extract(content, "PatientName",      "0010,0010")
    study_uid         = extract(content, "StudyInstanceUID",  "0020,000D")
    study_description = extract(content, "StudyDescription",  "0008,1030")
    study_date        = extract(content, "StudyDate",         "0008,0020")
    modality          = extract(content, "ModalitiesInStudy", "0008,0061")
    if not modality:
        modality      = extract(content, "Modality",          "0008,0060")

    s = {
        "patient_name": patient_name,
        "study_instance_uid": study_uid,
        "study_description": study_description,
        "study_date": study_date,
        "modality": modality,
    }
    all_studies.append(s)
    print(f"\n  Study {idx}: {json.dumps(s, indent=4)}")

section("SUMMARY")
print(f"  Found {len(all_studies)} studies via C-FIND")
if all_studies:
    has_data = any(s["patient_name"] or s["study_description"] or s["modality"] for s in all_studies)
    if has_data:
        print("  ✓ Metadata fields are being extracted correctly")
    else:
        print("  ✗ All metadata fields are EMPTY — field extraction is broken")
        print("    Check the raw content in Step 6 above for the actual key names")
