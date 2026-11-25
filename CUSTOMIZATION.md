# Customising Komorebi Bridge

Komorebi Bridge is built to look good and feel effortless to use. Start with the defaults until your first room runs smoothly, then feel free to reshape the look, layout, and everyday UI flows to fit how you work.

Customisation is split into two clear layers: **the Customisable Layer** (open for you to edit freely) and **the Protected Core** (kept untouched for stability and security).

---

## Layer 1: Customisable Layer (Edit Freely)

You are free to edit and adapt the frontend interface for your own use:

- **`src/components/`** — UI components, layout, button placement, panels, and simple UI flows
- **`src/App.tsx`** — main workspace layout, navigation, and screen composition
- **`src/index.css`** (and any other CSS files) — colour themes, spacing, and visual styling
- **`src/i18n/`** — interface wording and translations (`zh`, `en`, `ja`)
- **`src/assets/`** — bundled frontend assets
- **`src/data/`** — character names, profiles, and UI data (the app display name itself is the `KOMOREBI_DISPLAY_NAME` setting)
- **`public/` images & icons** — `public/avatars/`, `public/icons/`, and `public/assets/`
- **`index.html`** — page title and web fonts

**Examples of what you can customise**:
- Colour themes, dark/light palettes, and visual polish
- Page layout, panel arrangement, button placement, and home screen
- Character names, avatars, and interface wording
- Simple UI flows to make everyday tasks faster and more comfortable

**Build after UI changes**: after editing `src/`, `public/`, or `index.html`, run `npm run build` and ask the user to refresh the page. The built UI is read from disk; Bridge need not restart. Set `KOMOREBI_UI=dev` before starting Bridge for immediate development previews.

**Tips for safe UI editing**:
- **Use your own agent**: feel free to ask a coding agent (such as a dedicated maintenance room) to help redesign or tweak the Customisable Layer.
- **Keep a Git branch or backup**: commit or back up your working state before making changes so you can roll back cleanly if an edit breaks the UI.

### In-App Settings, Skills & Optional Integrations

You can also adjust these without touching code:

- **Rooms, groups & settings**: rename rooms, assign group roles, choose working folders, switch approval modes, and pick interface language (`zh` / `en` / `ja`) or theme (Auto / System / Light / Dark) directly inside the app.
- **Shared skills**: place reusable `SKILL.md` folders in your shared skills directory (`KOMOREBI_SKILLS`; default: workspace `skills/`, else the repo `skills/`) and link them across CLIs with `scripts/komorebi-skills link`. Starter SOPs live in [`skills/lead/SKILL.md`](skills/lead/SKILL.md) and [`skills/member/SKILL.md`](skills/member/SKILL.md).
- **Agent instructions**: copy [`AGENTS-snippet.md`](AGENTS-snippet.md) into your project or global `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, and optionally add your own persona section.
- **Remote access (Tailscale)**: keep Bridge on localhost (`KOMOREBI_HOST=127.0.0.1`), set `KOMOREBI_TAILSCALE=1`, expose only your local port inside your private tailnet with `tailscale serve` (never Funnel), and set a pairing key in macOS login Keychain (`service: komorebi-pairing-key`, `account: komorebi`) or the `KOMOREBI_PAIRING_KEY` setting.
- **Optional tools**: GitHub CLI (`gh`) for the GitHub panel, `whisper-cpp` + Whisper model (`KOMOREBI_WHISPER_MODEL`) for voice input, and Google Drive for desktop for read-only Drive browsing under `~/Library/CloudStorage/`.

---

## Layer 2: Protected Core (Do Not Modify)

The following files and directories form the **Protected Core** of Komorebi Bridge:

- **`server.ts`** — Bridge HTTP/WebSocket server, PTY lifecycle, pairing/authentication, and file-safety guards
- **`bridge/`** — core Bridge protocol, workbench, room/group coordination, state persistence, and tests
- **`scripts/`** — Bridge CLI and service scripts (`komorebi-room`, `komorebi-service.sh`, `komorebi-skills`, smoke scripts)
- **`src/types/`** — frontend–Bridge protocol and API type contracts
- **`public/sw.js`** — service worker
- **`package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`** — dependency, runtime, and build configuration

**Why these are protected**: these files handle CLI execution, security, pairing, and file-safety guarantees. Modifying them is unsupported, outside the licence (see [`LICENSE.md`](LICENSE.md)), and will be overwritten when you update Komorebi Bridge. Do not ask setup or maintenance agents to patch Protected Core files on your behalf.

---

## Protocol Compatibility, Updates & Sharing

- **Protocol compatibility**: if a UI edit causes the frontend to diverge from the Bridge protocol (defined by `server.ts`, `bridge/`, and `src/types/`), that custom state is unsupported.
- **Merging updates**: when updating Komorebi Bridge, you are responsible for merging your own UI changes. Keeping your customisations on a dedicated Git branch makes updates and rollbacks much easier.
- **Attribution & stable identifiers**: inside the app, you are completely free to rename the display name, workspace title, and character names however you like — just keep [`LICENSE.md`](LICENSE.md) and [`NOTICE.md`](NOTICE.md) intact, and keep underlying CLI IDs (`CLAUDE`, `CODEX`, `AGY`), session IDs, pairing credentials, and PWA identifiers stable.
- **Sharing your customisations**: customise or rename it however you like for your own use (there is no need to publish private changes). If you want to share your UI customisations or a customised version with others, you must keep the **Protected Core completely unmodified**, share it **under this same licence and free of charge**, keep [`LICENSE.md`](LICENSE.md) and [`NOTICE.md`](NOTICE.md) intact, and clearly state externally that it is based on Komorebi Bridge (for example, `Based on Komorebi Bridge by Team Komorebi`) rather than claiming it as your own product. Versions with a modified Protected Core may not be distributed (see [`LICENSE.md`](LICENSE.md)).
