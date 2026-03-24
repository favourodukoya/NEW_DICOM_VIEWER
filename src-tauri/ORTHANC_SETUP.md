# Orthanc Setup Guide

## Dev Mode (`cargo tauri dev`)

Orthanc is **not** started automatically in dev mode. You must run it manually:

```powershell
# Windows — after downloading Orthanc (see below)
.\Orthanc.exe
```

The app expects Orthanc on `http://127.0.0.1:8042` by default.
You can change this in the app's Settings → Orthanc tab.

---

## Production Build (`cargo tauri build`)

For a packaged `.exe` installer, Orthanc is bundled as a sidecar binary
and started automatically when the app launches.

### Step 1 — Download Orthanc for Windows

From https://orthanc.uclouvain.be/downloads/windows-msvc/ grab:
- `Orthanc.exe`  (latest stable)
- `DicomWebPlugin.dll`

### Step 2 — Place files

```
src-tauri/
  binaries/
    Orthanc-x86_64-pc-windows-msvc.exe   ← rename Orthanc.exe to this exact name
  orthanc/
    DicomWebPlugin.dll                    ← DICOMweb plugin
```

The binary suffix **must** match the Rust target triple.
Check yours with: `rustup show active-toolchain`

Common triples:
| Platform        | Suffix                          |
|-----------------|---------------------------------|
| Windows x64     | `x86_64-pc-windows-msvc`        |
| macOS Intel     | `x86_64-apple-darwin`           |
| macOS Apple Si  | `aarch64-apple-darwin`          |
| Linux x64       | `x86_64-unknown-linux-gnu`      |

### Step 3 — Merge the bundle config

`tauri.bundle.conf.json` in this folder adds `externalBin` and `resources`
for the production build. Pass it to the build command:

```powershell
cargo tauri build --config src-tauri/tauri.bundle.conf.json
```

Or merge its contents into `tauri.conf.json` permanently once you have the binary.

### Step 4 — Build

```powershell
cd C:\Users\3ples\Desktop\__NEW_DICOM_VIEWER__
cargo tauri build --config src-tauri/tauri.bundle.conf.json
```

The installer will be at `src-tauri/target/release/bundle/`.

---

## Orthanc Runtime Config

Config is auto-generated at first launch in the app's data directory:
- **Windows**: `%APPDATA%\ukubona-viewer\orthanc\orthanc.json`
- **macOS**: `~/Library/Application Support/com.ukubona.viewer/orthanc/orthanc.json`
- **Linux**: `~/.local/share/com.ukubona.viewer/orthanc/orthanc.json`

DICOM storage: `orthanc_storage/` in the same parent directory.
