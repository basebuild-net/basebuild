# Release Secrets

This document lists the credentials used by the cross-platform release
workflow. Never print, commit, or attach their values to a release.

## Required GitHub repository secrets

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Ed25519 private key used to sign Windows, Linux, and macOS updater bundles. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the updater key; leave unset only when the generated key has no password. |
| `GITHUB_TOKEN` | Automatically provided by GitHub Actions to create and update the draft release. |

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

## Signing boundaries

The Tauri updater key signs update payloads for in-app verification. It is not
Windows Authenticode signing, Apple Developer ID signing, or Apple
notarization. Without the updater key, the release matrix cannot produce the
required `.sig` files and `verify-release` fails; do not publish that draft.

Windows installers are not Authenticode-signed until a separate certificate
and Tauri Windows signing configuration are added. macOS falls back to the
ad-hoc identity (`-`) in `tauri.conf.json`, which supports Apple Silicon but
still produces the unidentified-developer Gatekeeper flow.

### Optional macOS Developer ID and notarization secrets

Configure all of these together to replace the ad-hoc identity with a
notarized Developer ID release:

| Secret | Purpose |
|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12`; imported into an ephemeral CI keychain. |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12`. |
| `KEYCHAIN_PASSWORD` | Ephemeral CI keychain password. |
| `APPLE_ID` | Apple developer account email used by the notarization service. |
| `APPLE_PASSWORD` | App-specific Apple password, not the account password. |
| `APPLE_TEAM_ID` | Apple Developer team identifier. |

The workflow rejects a supplied certificate without its certificate and
keychain passwords. Tauri performs notarization only when the Apple account
credentials are also present.

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

## Setup checklist

1. Keep the public updater key in `src-tauri/tauri.conf.json` matched to the
   private `TAURI_SIGNING_PRIVATE_KEY` repository secret.
2. Run a draft release and require updater signatures plus all four platform
   entries in `latest.json` before publishing.
3. Optional: configure the complete Apple secret set above for notarized macOS
   releases.
4. Optional: add a Cloudflare Worker to serve `manifest.json` from R2.

## Analytics upload (future)

If a remote analytics upload endpoint is ever enabled, the endpoint URL, auth token, and upload interval MUST be documented here before the upload code path is activated. Until then, the `allowUsageAnalyticsUpload` permission is `false` by default and the upload toggle is hidden in settings.