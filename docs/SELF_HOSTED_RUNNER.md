# Self-Hosted Runner Setup

The Windows CI/release workflow (`.github/workflows/windows.yml`) uses a self-hosted runner with the label `self-hosted`. This guide walks through installing and configuring the runner.

> **Important:** To build the Windows NSIS installer, the self-hosted runner must be a **Windows** machine with Visual Studio C++ Build Tools, Node.js, and Rust installed. The commands below are the standard Linux example from GitHub; if your runner is Windows, use the Windows runner package instead.

## Create and configure the runner

Open a terminal on the machine that will run builds (PowerShell on Windows, Bash on Linux):

```bash
# Create a folder
mkdir actions-runner && cd actions-runner

# Download the latest runner package
# Linux x64 example:
curl -o actions-runner-linux-x64-2.335.1.tar.gz -L https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz

# Optional: validate the hash
echo "4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf  actions-runner-linux-x64-2.335.1.tar.gz" | shasum -a 256 -c

# Extract the installer
tar xzf ./actions-runner-linux-x64-2.335.1.tar.gz

# Configure the runner against the repo
./config.sh --url https://github.com/basebuild-net/basebuild --token <TOKEN>

# Start the runner
./run.sh
```

For a Windows runner, download the Windows runner package from [GitHub Actions Runner releases](https://github.com/actions/runner/releases) and run `config.cmd` / `run.cmd` instead.

## Required runtime dependencies

- **Node.js 20+** and `npm`
- **Rust (stable toolchain)**
- **Visual Studio C++ Build Tools** with the MSVC workload and Windows SDK (required on Windows)
- **NSIS tools for Tauri** are downloaded automatically during the first build

## Workflow configuration

Each job already specifies:

```yaml
runs-on: self-hosted
```

GitHub will schedule workflow runs on your registered runner once it comes online.

## Security notes

- The runner registration token from GitHub is short-lived. Do not check it into the repo.
- Runners execute arbitrary code from the repository. Only run self-hosted runners on trusted private machines.
- Make sure the runner user has permission to clone the repo and push/pull from `https://github.com/basebuild-net/basebuild`.

## Running as a service (Linux)

```bash
sudo ./svc.sh install
sudo ./svc.sh start
```

On Windows, use `.un.cmd` interactively or configure the runner as a Windows service via `.\svc.cmd`.
