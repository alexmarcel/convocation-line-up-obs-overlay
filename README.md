# Anugerah Pengarah Display

A Windows/Electron graduation line-up system for barcode-driven projector and OBS graphics. One controller computer owns the ceremony data and hosts three browser clients over a trusted local network, so the show can run without internet access.

## Project rundown

The application has four interfaces:

| Interface | Location | Responsibility |
| --- | --- | --- |
| Controller | Electron desktop window (`/controller`) | Imports and edits the ceremony library, records names, manages backups, monitors devices, controls the live display, and can optionally monitor announcement audio |
| Scanner | `/scanner` | Accepts barcode scans or manual student searches and reports delivery status |
| Projector | `/projector` | Shows the full student presentation and optionally plays the announcement |
| OBS | `/obs` | Renders a broadcast lower third with transparent or chroma-key background |

At startup, Electron launches an HTTP and WebSocket server on port `4173`. Remote browsers download a role-specific, versioned library and retain it in IndexedDB. The controller then sends small live events such as “show student” and “clear”; images, student details, and audio are rendered from each client's verified local cache.

Synchronization completion is tracked independently for Scanner, Projector, and OBS, even when several roles use the same browser profile. A client reporting **Ready** has verified that every asset required by its role is present locally.

Key reliability behavior:

- The controller is the source of truth for the current library and live state.
- Assets are SHA-256 verified before a new library becomes active on a client.
- A previous library remains usable until its replacement is completely downloaded.
- Required outputs must be connected and synchronized before a scanner can send a student live.
- Scans made while a scanner is offline are queued locally and require explicit controller approval after reconnection.
- Library publication and restores use staged activation, safety snapshots, and rollback handling.
- Factory reset uses an allowlisted, journaled transaction so interrupted resets finish safely without deleting unrelated Electron data.
- Only one controller instance can run per Windows user.

## Repository layout

```text
.
|-- src/                 Electron main process and backend modules
|   |-- main.js          App lifecycle, IPC, file dialogs, and managed storage
|   |-- server.js        LAN HTTP/WebSocket server and live state
|   |-- library.js       CSV/media import and library publication
|   |-- maintenance.js   Staged student and media editing
|   |-- recordings.js    Recording drafts and publication
|   |-- backups.js       Portable backups, snapshots, restore, and recovery
|   `-- factory-reset.js Allowlisted blank-state reset and crash recovery
|-- public/              Controller, scanner, projector, and OBS front ends
|-- test/                Node test suite
|-- scanner.html         Legacy standalone prototype; not used by the app
|-- students_new.csv     Small example CSV
`-- package.json         Scripts, dependencies, and Windows build settings
```

The project uses CommonJS and intentionally has no front-end bundling step. Electron serves the files in `public/` directly. The installer includes only `src/`, `public/`, and `package.json`.

## Requirements

For operation:

- Windows 10 or 11 controller computer
- Chrome or Edge on scanner/output computers
- A trusted LAN shared by all devices
- A USB barcode scanner in keyboard-emulation mode
- A controller microphone if names will be recorded in the application

For development:

- Node.js 20 or newer
- npm

For live events, a dedicated router and wired Ethernet are strongly recommended. Set the controller's Windows network profile to **Private**, allow the app through Windows Firewall on private networks, and disable sleep and automatic restarts on show computers.

## Quick start for developers

Install dependencies and launch the Electron controller:

```powershell
npm install
npm start
```

Run the automated tests:

```powershell
npm test
```

Build the Windows NSIS installer and portable executable:

```powershell
npm run dist
```

Build only the portable executable:

```powershell
npm run pack
```

Build artifacts are written to `dist/`.

## Preparing ceremony data

### Student CSV

The CSV requires these exact headers:

```csv
id,name,group,marks
10001,Ahmad Bin Ali,MERAH,95%
10002,Siti Nurhaliza,BIRU,88%
```

Fields may be quoted and may contain commas or line breaks. Import rejects missing headers, empty required values, and duplicate IDs.

### Photos

Name each image after the matching student ID:

```text
photos/
|-- 10001.jpg
`-- 10002.png
```

JPG, PNG, and WebP are supported. The importer optimizes full-size images and creates scanner thumbnails.

### Existing audio

Existing announcements can be imported in the same way:

```text
audio/
|-- 10001.mp3
`-- 10002.wav
```

MP3 and WAV are supported. Audio is optional because names can also be recorded in the controller.

## Ceremony workflow

1. Launch **Anugerah Pengarah Display** on the controller computer.
2. Select **Start new ceremony**, then choose the CSV and optional photo/audio folders.
3. Review counts, the collapsed unmatched-media list, and missing photos in the controller.
4. If needed, use **Record student names** and publish the accepted recording batch.
5. Open the LAN URLs shown by the controller on the scanner, projector, and OBS computers.
6. Configure required outputs, remote and optional Controller audio, fade timings, colors, projector backgrounds, and OBS background mode.
7. Wait for every required station to report **Ready** and run a full rehearsal.
8. Scan each student's ID. Use **Clear display** when the stage should be empty.

The displayed URLs resemble:

```text
http://192.168.1.20:4173/scanner
http://192.168.1.20:4173/projector
http://192.168.1.20:4173/obs
```

The controller must remain open for the entire ceremony.

The packaged controller hides Electron's default File/Edit/View/Window menu to reduce accidental reloads or developer-tool access during live operation.

The controller hero summarizes live ceremony state at a glance. It shows setup, synchronization, output-readiness, and reconnecting states; after a successful scan it shows the current student's photo, name, ID, group, and marks until the display is cleared.

### Scanner behavior

The scanner field automatically regains focus and accepts scanners that append Enter or carriage return. Operators can also type part of a name or ID and choose a search result. Unknown IDs are rejected and do not change projector or OBS output.

After a valid scan, the Scanner card and controller hero each run their own elapsed/total timeline from the student's published audio. When no published recording exists, the timeline remains gray and reports **No published audio**.

If the scanner loses its connection, scans are stored in its browser. They never replay automatically. After reconnection, review them under **Offline scan approvals** and approve or discard each event.

### Recording names

The recording studio stores drafts immediately, so they survive a controller restart. Drafts stay off-air until **Publish recordings** creates a new library revision.

| Key | Action |
| --- | --- |
| `Space` | Start or stop recording |
| `Enter` | Save and move to the next student |
| `Left` / `Right` | Previous or next student |
| `Delete` | Remove a draft before replacing it |
| `Escape` | Close the recording studio |

Recordings are saved as mono WAV, with conservative silence trimming and normalization.

### Editing an active ceremony

Use **Manage library** to add, edit, remove, or reorder students and to replace media. Changes go to a resumable working copy and do not reach live clients until **Publish changes**.

Use **Update current ceremony** to reconcile a revised CSV. Existing IDs are updated, new IDs are added, and omitted students are retained for explicit review. Existing media and recording drafts remain unless replacements are selected.

### Projector and OBS

Output settings are grouped into **Event & branding**, **Audio**, **Student transitions**, **Projector**, and **OBS** cards. Short descriptions remain visible while focused or hovered information icons explain settings that need more context.

The Projector section provides a **Student display background** with adjustable darkness and a separate **Cleared-display standby background**. The student background remains behind student information; the standby image fades in only after **Clear display** and disappears when the next student is shown. Both assets are synchronized to Projector devices and included in ceremony backups. The Projector top header can show the event name or be hidden.

OBS supports a transparent canvas or a configurable chroma-key color. Audio can be routed to Projector, OBS, both, or neither; normally only one output should play audio to avoid duplication.

The Audio card supports independent 0–10 second fade-in and natural fade-out timings. A value of zero disables that fade. Routing and fade settings synchronize to connected outputs and are preserved in backups.

Student changes on OBS and Projector can use **Fade**, **Fade + rise**, or **None**, with a shared 0.1–3.0 second duration for each exit and entrance phase. The previous card exits before its content is replaced, and announcement audio starts as the new card enters. **Clear display** also animates the active card out before the Projector standby background or empty OBS canvas appears.

Before rehearsal, select **Enable audio** once on every browser output that will play announcements. For an OBS Browser Source, open **Interact** for the source and select the button there. The display reports blocked playback, missing recordings, and decoding failures instead of failing silently.

To monitor announcements through the Controller computer, enable **Also play on Controller** in Output settings and select **Enable Controller audio** once after each application start. Controller playback uses the operating system's default sound device and the same fade timings as remote outputs. It is optional monitoring and never blocks a scan or counts as a required output.

Scanner, Projector, and OBS browser-window titles include the configured event name, for example `Awards Night - Scanner` and `Awards Night - OBS`.

Connected devices can be renamed from the controller. The remote title updates to `Event Name - Device Name`, and the name survives reconnection.

Projector and OBS cards show a green speaker when that device's audio is enabled and a red muted-speaker when it is muted.

Audio readiness is reported by each remote browser. The read-only controller indicator remains red until the operator selects **Enable audio before going live** on that device, then turns green. Browser security prevents the controller from supplying that remote user gesture itself.

The controller groups connected-device cards by role—Controller, Scanners, Projectors, and OBS—with a count for each active group.

Required-output selections are scoped to the active ceremony. Newly discovered stations are optional by default and must be explicitly checked as **Required**. Choices survive an application restart for that ceremony, but starting a new ceremony or restoring a backup begins with a clean station list. Portable backups intentionally exclude station IDs because those identify venue hardware. Use **Clear remembered outputs** to remove obsolete stations without changing ceremony data; any currently connected Projector or OBS station is rediscovered immediately.

If a photo is missing or corrupt, the previous photo is cleared immediately. Student text, animation, scan delivery, and any valid audio continue normally.

## Backups and recovery

**Export backup** creates a portable `.graduation-backup` archive containing the active library and unpublished recording drafts, with a SHA-256 inventory. A restore validates the archive before replacing data and creates a safety snapshot of the current state first.

Automatic snapshots are also created before high-risk publication operations. The five newest successful snapshots are retained. Restore operations are journaled so an interrupted restore can be rolled back on the next launch.

Recurring safety snapshots can be enabled from the collapsed **Backup & Restore** panel at 5, 10, or 30-minute intervals. They run silently when the controller is idle. Pre-operation safety snapshots remain enabled independently to preserve rollback protection.

The panel's **Danger zone** provides **Reset everything** for returning the application to a first-run state. It requires typing `RESET EVERYTHING` and permanently removes ceremonies, media, drafts, settings, remembered outputs, event history, and safety snapshots without creating a recovery copy. Connected displays clear their ceremony cache while retaining their station identity and name; devices that were offline are cleared when they next connect to the blank controller.

Restoring replaces the active library and drafts; it does not merge them.

## Barcode labels

The controller can generate Code 128 labels for selected students, with presets or custom millimetre dimensions, optional student fields, multiple copies, cutting guides, printing, and PDF export. Labels encode the exact CSV student ID. Print at 100% scale for reliable scanning.

## Data storage

The installed application normally resides under:

```text
%LOCALAPPDATA%\Programs\Anugerah Pengarah Display\
```

Managed data is stored beneath Electron's per-user application-data directory, normally:

```text
%APPDATA%\Anugerah Pengarah Display\
|-- ceremony-library\
|-- ceremony-library.previous\
|-- library-working\
|-- recording-drafts\
|-- backups\
|-- controller-settings.json
|-- output-registry.json
`-- event-ledger.json
```

Temporary restore and reset journals may also appear while those operations are active and are cleaned during successful completion or startup recovery. The exact application-data folder name can vary with application identity/version. Remote client caches live in the browser's IndexedDB database named `graduation-display`.

## Security model

This application intentionally uses open access on the local network. Anyone who can reach the controller's address can open a scanner or output route. Run it only on a dedicated or otherwise trusted ceremony LAN; it is not designed to be exposed to the public internet.

## Legacy prototype

`scanner.html` is the original serverless prototype and remains only as a reference. The Electron application does not load it.
