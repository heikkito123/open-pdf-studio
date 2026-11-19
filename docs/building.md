# Building from source

## Prerequisites

- [Node.js](https://nodejs.org/) 22.13 or later in the 22 series (CI uses 22),
  or 24 or newer, as required by the locked PDF.js dependency
- [Rust](https://www.rust-lang.org/tools/install) **1.99.1**, matching CI.
  The workflow pins this version because Rust 1.100 breaks tauri-build 2.6.2.
- [CMake](https://cmake.org/download/) and a C/C++ toolchain
- System dependencies:
  - **Linux:** `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`,
    `pkg-config`, `libssl-dev` and `libxdo-dev`. The older `libappindicator3-dev`
    conflicts with the Ayatana runtime installed on Ubuntu 24.04.
  - **macOS:** Xcode Command Line Tools; universal release builds also need the
    `aarch64-apple-darwin` and `x86_64-apple-darwin` Rust targets
  - **Windows:** Visual Studio Build Tools with the C++ workload

## Development

On Debian/Ubuntu, run the setup script as your normal user from the repository
root. It uses sudo for APT, installs the pinned Rust toolchain, installs npm
dependencies and verifies the downloaded OCR assets. It does not launch the app.

```bash
bash open-pdf-studio/scripts/setup-linux.sh
source "$HOME/.cargo/env"
```

If the prerequisites are already installed:

```bash
cd open-pdf-studio
npm ci
npm run tauri:dev
```

`predev` prepares the native PDFium runtime and the OCR runtime and builds the
`pdfium-worker` sidecar and the thumbnail handler before Vite starts.

## Release build

```bash
cd open-pdf-studio
npm ci
npm run tauri:build
```

The build downloads the pinned PDFium runtime for the platform and verifies its
SHA-256 checksum. Build artifacts are written to the workspace-level
`target/release/bundle/` directory, or `target/universal-apple-darwin/release/bundle/`
for a universal macOS build. The release workflow
([`.github/workflows/release.yml`](../.github/workflows/release.yml)) is the
reference for every platform, including signing.

## Web version

```bash
cd open-pdf-studio
npm ci
OPDS_WEB_BUILD=1 npx vite build
```

This is how the public browser version is built (`.github/workflows/live.yml`).
`npm run build:hosted` builds the bundle for hosting on another platform under
any sub-path; `npm run pack:hosted` packs it as the release archive.

## Tests

```bash
cd open-pdf-studio
npm run test:unit       # the unit tests listed in scripts/unit-testlijst.txt
npm run test:quality    # quality regression tests
```

New unit tests go next to the code as `*.test.mjs` and are added to
`scripts/unit-testlijst.txt`.

The takeoff browser regression clicks saved measurement tools, verifies their
subjects and calibration, and downloads the quantities CSV:

```bash
npx playwright install chromium
node scripts/test-takeoff-tools-browser.mjs
```

Set `OPDS_TEST_PDF` to a local drawing to use it instead of the generated PDF.

## README images

```bash
cd open-pdf-studio
node scripts/generate-readme-screenshots.mjs   # builds the web version and writes docs/images/readme/*.png
node scripts/check-readme-images.mjs           # every image present, used in both READMEs and at most 150 kB
```

The screenshot script makes its own demo PDFs (`scripts/readme-demo-pdfs.mjs`)
and drives the web version in headless Chromium. It needs the Playwright
Chromium browser (`npx playwright install chromium`).

## Platform notes

- Linux packaging details and fixes: [docs/linux-build-fixes.md](linux-build-fixes.md)
- Windows distribution, winget and the Microsoft Store: [docs/windows-distribution.md](windows-distribution.md)
- The portable Windows zip: [docs/portable-windows.md](portable-windows.md)
- Flatpak and Flathub: [docs/flathub.md](flathub.md)
