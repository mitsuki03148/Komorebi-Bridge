# Legal Notices & Third-Party Components

- **Product**: Komorebi Bridge
- **Rights Holder**: Team Komorebi
- **Author / Contributor Credits**: `<AUTHOR / CONTRIBUTOR CREDITS>`
- **Official Source**: `https://inkomorebi.dev`
- **Licence**: See [`LICENSE.md`](LICENSE.md) (draft, pending owner confirmation and legal review)

Original copyright, credit, and licence notices must remain intact. If you create your own custom theme, avatars, or character setup, you may add your own credit alongside the original Komorebi Bridge credits.

---

## Direct Third-Party Dependencies (`package.json`)

The following third-party packages are declared directly in `package.json`. Each package remains subject to its own licence.

### Runtime & Application Dependencies

| Package | Installed Version | Licence |
| --- | --- | --- |
| `@google/genai` | `2.32.0` | Apache-2.0 |
| `@tailwindcss/vite` | `4.3.5` | MIT |
| `@vitejs/plugin-react` | `6.3.0` | MIT |
| `@xterm/headless` | `6.0.0` | MIT |
| `chokidar` | `6.0.0` | MIT |
| `dotenv` | `17.4.2` | BSD-2-Clause |
| `express` | `4.22.3` | MIT |
| `lucide-react` | `0.546.0` | ISC |
| `mdast-util-from-markdown` | `2.1.0` | MIT |
| `motion` | `12.43.0` | MIT |
| `node-pty` | `1.1.0` | MIT |
| `qrcode` | `1.5.4` | MIT |
| `react` | `19.3.1` | MIT |
| `react-dom` | `19.3.1` | MIT |
| `react-markdown` | `10.1.0` | MIT |
| `recharts` | `3.10.1` | MIT |
| `remark-gfm` | `4.0.1` | MIT |
| `vite` | `8.3.8` | MIT |
| `web-push` | `4.0.0` | MPL-2.0 |
| `ws` | `8.22.2` | MIT |

### Development & Build Dependencies

| Package | Installed Version | Licence |
| --- | --- | --- |
| `@types/express` | `4.17.25` | MIT |
| `@types/node` | `22.20.5` | MIT |
| `@types/qrcode` | `1.5.6` | MIT |
| `@types/react` | `19.3.0` | MIT |
| `@types/react-dom` | `19.3.0` | MIT |
| `@types/web-push` | `3.6.4` | MIT |
| `@types/ws` | `8.18.2` | MIT |
| `autoprefixer` | `10.6.2` | MIT |
| `esbuild` | `0.28.2` | MIT |
| `playwright-core` | `1.55.0` | Apache-2.0 |
| `tailwindcss` | `4.3.5` | MIT |
| `tsx` | `4.23.15` | MIT |
| `typescript` | `7.0.2` | Apache-2.0 |

*(Transitive dependencies installed via `npm ci` are listed in `package-lock.json` and remain governed by their respective licences.)*

---

## Web Fonts (`index.html`)

The web interface currently loads the following font families remotely from **Google Fonts** in `index.html` (no font files are bundled in this repository):

- **Fredoka** (weights `500`, `600`, `700`)
- **JetBrains Mono** (weights `400`, `500`, `600`)
- **Plus Jakarta Sans** (weights `400`, `500`, `600`, `700`)

Each font family is governed by its own licence as published on Google Fonts. If a future release bundles font files directly, the licence for the bundled font version will be verified and listed here.

---

## External Tools (Not Bundled)

Komorebi Bridge integrates with optional external tools installed separately by the user (such as Claude Code, Codex CLI, Antigravity / Gemini CLI, Tailscale, GitHub CLI `gh`, `whisper-cpp` and Whisper models, and Google Drive for desktop). None of these tools are bundled with Komorebi Bridge; each is governed by its own licence and terms of service.
