# Release Secrets

This document lists the secrets and keys required to ship Basebuild app updates and to upload release artifacts to Cloudflare.

## Required GitHub repository secrets

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Ed25519 private key used to sign update bundles. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Optional password for the private key. |
| `GITHUB_TOKEN` | Automatically provided by GitHub Actions to create draft releases. |

## Generating the Tauri updater signing key

```powershell
# From the repo root
npx @tauri-apps/cli signer generate
```

Store the private key as `TAURI_SIGNING_PRIVATE_KEY` and the public key as `TAURI_SIGNING_PUBLIC_KEY`.

Update `src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "pubkey": "<TAURI_SIGNING_PUBLIC_KEY>"
    }
  }
}
```

## Unsigned releases

The GitHub Actions workflow (`.github/workflows/windows.yml`) will build and draft a release without any secrets. The installer is still produced, but the Tauri updater `.sig` files will be missing, so in-app auto-updates will not be trusted until a signing key is configured.

## Cloudflare Worker update manifest (future)

The app checks a static JSON manifest URL such as:

```
https://updates.basebuild.app/manifest.json
```

The expected format is:

```json
{
  "version": "0.2.0",
  "notes": "Release notes...",
  "pubDate": "2026-06-30T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://assets.basebuild.app/Basebuild_0.2.0_x64-setup.exe"
    }
  }
}
```

## Optional Cloudflare upload secrets

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Upload release artifacts or manifest to R2 / Workers. |
| `CLOUDFLARE_ACCOUNT_ID` | Required for R2 bucket uploads. |
| `CLOUDFLARE_R2_BUCKET` | Target R2 bucket name. |

## Future setup checklist

1. Replace `PLACEHOLDER_PUBLIC_KEY` in `tauri.conf.json`.
2. Set `TAURI_SIGNING_PRIVATE_KEY` in repository secrets.
3. Optional: add a Cloudflare Worker to serve `manifest.json` from R2.
