# Desktop releases and Steam preparation

Eternal Realms runs as a standalone desktop application. Its Three.js renderer and
Rapier physics execute inside a sandboxed Electron window. The game is not a
native Unity/Unreal application. Packaged releases do not open a browser and do not
need a development server, Node.js installation, or an Internet connection.

## Build from source

Use Node.js 22.16+ (Node.js 24 recommended) and npm. Release packaging in this
repository is tested on Linux and also requires the `zip` and `tar` command-line
utilities. Windows developers can use a Linux CI runner or WSL to produce both
archives; ordinary play does not require those tools. From the repository root:

```sh
npm ci
npm run build
npm run desktop
npm run package:desktop
```

The packaging command creates Windows x64 and Linux x64 application folders and
compressed archives in `release/`, with checksums in `release/SHA256SUMS.txt`.
Target only one platform with `node scripts/package-desktop.mjs win32` or
`node scripts/package-desktop.mjs linux`. Cross-packaging a Windows executable on
Linux is supported; this does not replace testing on Windows hardware.
All downloaded Electron distributions keep their official checksum verification.

Windows: extract the complete ZIP and launch `Eternal Realms.exe`. Linux: extract
the complete `.tar.gz` and run `./"Eternal Realms"`. Keep the executable together
with the accompanying resources and libraries. The executable cannot be copied
out of that folder on its own. F11 toggles full screen. Saves use Electron's local
application data and remain on the current OS account; Steam Cloud is not connected.

A Linux desktop must provide GTK, NSS, GBM, and audio runtime libraries. The cloud
machine's software-rendered automated check does not establish GPU performance on
player machines. Check minimum hardware requirements on real target hardware.
Windows binaries are unsigned; public distribution should add a trusted code-signing
certificate and clean-machine validation. A macOS build is not part of this stage.

## Steamworks prerequisites

Publishing to Steam requires the owner's Steamworks partner account, completed
identity/bank/tax onboarding, the Steam Direct application fee (normally USD 100
per application; verify Steam's current terms), an assigned App ID, and Windows/
Linux depot IDs. Publishing rights, approved store materials and a reviewed build
are separate requirements. This repository does not contain account credentials,
a real App ID, an upload, a released store page, or a Steamworks SDK redistribution.

Install Valve's Steamworks SDK ContentBuilder through your authorized account.
The example VDF files in `docs/steam/` are templates with explicit placeholder IDs.
Replace those IDs and content paths in a local copy before using SteamPipe.
Do not commit passwords, Steam Guard codes, or authenticated SDK session files.

Suggested Steamworks launch options (relative to each depot's content root):

| Target  | Executable           | Working directory | OS      | Architecture |
| ------- | -------------------- | ----------------- | ------- | ------------ |
| Windows | `Eternal Realms.exe` | `.`               | Windows | 64-bit       |
| Linux   | `Eternal Realms`     | `.`               | Linux   | 64-bit       |

The Windows depot content is the complete
`release/Eternal Realms-win32-x64/` folder. The Linux depot content is the complete
`release/Eternal Realms-linux-x64/` folder. Upload unpacked files, not the ZIP or
`.tar.gz`. Preserve executable permissions for the Linux depot. Start in a private
Steam testing branch and verify installation, launch, controllers/keyboard,
resolution changes, save persistence, offline play, and clean uninstall on both OSes.

Example invocation from Valve's ContentBuilder directory, after replacing every
placeholder and authenticating through your own account:

```sh
./builder_linux/steamcmd.sh +login YOUR_STEAMWORKS_USERNAME +run_app_build /absolute/path/app_build.vdf +quit
```

The template uses `Preview "1"`, so the example validates mappings without
uploading content. After inspecting that preview, change it to `Preview "0"` in
your local copy for an actual SteamPipe upload to a private test branch.
This command is documentation only; no upload or store publication has been run.
The templates do not mark a branch live. Review Steam's current release checklist,
store assets/trailers, system requirements, content disclosures and test reports
before requesting release review.

## Current integration status

Desktop executable packaging: provided. SteamPipe configuration templates:
provided. Steamworks achievements, leaderboards, overlay-specific integration,
Steam Input, Steam Cloud, cloud save conflict resolution and ownership API checks:
not implemented. The game may run when launched from Steam like other desktop
executables, but none of those Steamworks services are claimed to work.

## Optional cloud desktop smoke test

The native smoke test uses a real Electron window. On a workstation with a GUI:

```sh
npm run build
npm run test:desktop
```

For this Linux cloud machine, a small helper can recreate a virtual display using
its already installed Xorg executable, dummy driver and xfwm4 window manager
(compositing disabled). It does not install or
change system packages, and does not replace an existing display:

```sh
bash scripts/start-test-display.sh
DISPLAY=:99 ETERNAL_TEST_NO_SANDBOX=1 npm run test:desktop
```

`ETERNAL_TEST_NO_SANDBOX=1` is restricted-container test configuration. It is not
part of the packaged launcher or normal desktop instructions. Electron's renderer
isolation and sandbox settings remain enabled in application code. The test uses
SwiftShader and the game's Performance preset after a full-quality menu capture;
it validates functionality, not real-GPU frame rate. Writable test profiles are
placed under `/tmp`. Reports and screenshots are saved to `test-results/desktop/` (or
`test-results/desktop-packaged/` for a packaged executable).
To check the packaged Linux application, pass its executable path:

```sh
DISPLAY=:99 ETERNAL_TEST_NO_SANDBOX=1 node scripts/smoke-desktop.mjs \
  "release/Eternal Realms-linux-x64/Eternal Realms"
```

This optional helper requires the preinstalled Xorg dummy driver. Without that
capability and its preinstalled window manager, use an existing desktop display; a headless Chromium renderer test is
still available separately and should not be described as a native execution test.
