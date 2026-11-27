# Source map

## 想改甚麼，去哪裏

- 想改公會首頁與空房歡迎 → [`src/components/GuildHallHome.tsx`](src/components/GuildHallHome.tsx)（`Guild Hall welcome`）
- 想改角色空房的肖像動畫 → [`src/components/EmptyRoomState.tsx`](src/components/EmptyRoomState.tsx)（`Portrait animation`）
- 想改角色清單與房間選擇 → [`src/components/LeftCharacterMenu.tsx`](src/components/LeftCharacterMenu.tsx)（`Show the roster and room list`）
- 想改群組成員與側欄 → [`src/components/GroupRoomSidebar.tsx`](src/components/GroupRoomSidebar.tsx)（`Render the group sidebar`）
- 想改建立群組 → [`src/components/GroupChat.tsx`](src/components/GroupChat.tsx)（`Create a group`）
- 想改群組訊息排序 → [`src/components/GroupChat.tsx`](src/components/GroupChat.tsx)（`Order messages across rooms`）
- 想改群組聊天室與輸入 → [`src/components/GroupChat.tsx`](src/components/GroupChat.tsx)（`Read and respond in a group`）
- 想改群組角色與隊長 → [`bridge/groups.ts`](bridge/groups.ts)（`Set roles and choose a lead`）
- 想改群組名單交接 → [`bridge/groups.ts`](bridge/groups.ts)（`Share the roster`）
- 想改建立或搬移房間 → [`src/components/GuildModals.tsx`](src/components/GuildModals.tsx)（`Create a room`、`Move a room`）
- 想改換房與工作資料夾 → [`bridge/room-replace.ts`](bridge/room-replace.ts)（`Move a room and adopt its session`）
- 想改房間右鍵與長按選單 → [`src/App.tsx`](src/App.tsx)（`onContextMenu`）
- 想改單人房桌面工作區 → [`src/components/RightRoomWorkspace.tsx`](src/components/RightRoomWorkspace.tsx)（`Show and control a room`）
- 想改對話泡泡與訊息顯示 → [`src/components/MessageBubble.tsx`](src/components/MessageBubble.tsx)（`Render a message`）
- 想改對話複製按鈕 → [`src/components/CopyTurnButton.tsx`](src/components/CopyTurnButton.tsx)（`CopyTurnButton`）
- 想改模型與推理等級 → [`src/components/ModelEffortPicker.tsx`](src/components/ModelEffortPicker.tsx)（`Choose a model with a tap or a slide`、`Choose an effort level on the track`）
- 想改編輯器控制列 → [`src/components/ControlBar.tsx`](src/components/ControlBar.tsx)（`Render the composer controls`）
- 想改終端畫面與按鍵 → [`src/components/LiveTerminal.tsx`](src/components/LiveTerminal.tsx)（`Display the live terminal and send keys`）
- 想改 CLI 選單與審批解析 → [`bridge/terminal.ts`](bridge/terminal.ts)（`Read menus and confirmations`）
- 想改 CLI 對話歷史與監聽 → [`bridge/sessions.ts`](bridge/sessions.ts)（`Watch session files`）
- 想改 HP／MP 額度顯示 → [`src/components/GuildModals.tsx`](src/components/GuildModals.tsx)（`Check quota use`）
- 想改 AGY 額度讀取 → [`bridge/usage.ts`](bridge/usage.ts)（`agyUsage`）
- 想改派單與工作台 → [`bridge/bench-server.ts`](bridge/bench-server.ts)（`Deliver and handle workbench requests`）
- 想改完成回報與取消工單 → [`bridge/bench.ts`](bridge/bench.ts)（`Complete or cancel tickets`）
- 想改交接與發送指令 → [`bridge/handoff.ts`](bridge/handoff.ts)（`Send a direct handoff`）
- 想改自動壓縮設定 → [`src/components/SettingsModals.tsx`](src/components/SettingsModals.tsx)（`Room defaults and compaction`）
- 想改外觀與語言設定 → [`src/components/SettingsModals.tsx`](src/components/SettingsModals.tsx)（`Appearance and languages`）
- 想改重啟 Bridge → [`src/components/SettingsModals.tsx`](src/components/SettingsModals.tsx)（`Restart the Bridge`）
- 想改 worktree 名額與建立 → [`bridge/auto-worktree.ts`](bridge/auto-worktree.ts)（`bridgeWorktreeLimit`）
- 想改查看檔案與差異 → [`src/components/WorktreePanel.tsx`](src/components/WorktreePanel.tsx)（`Show diffs and files`）

<!-- source-map:start -->

## 檔案目錄

### `bridge/bench-server.ts`

- Choose a role recipient — select an eligible group member from one Bridge snapshot.
- Check receipts and resolve ticket recipients — use the Bridge's current rooms and groups.
- Deliver and handle workbench requests — save tickets and report their delivery state.
- Close a lead's outstanding tickets — cancel unfinished work after the final report.
- Wake fixed recipients — recheck the ticket and room before each input phase.
- Restore context and deliver hook tickets — keep injected state within the hook envelope.
- Wake rooms and report stalled work — retry eligible tickets and notify the lead when needed.

### `bridge/bench.ts`

- Ticket records and limits — Define the records shared with callers and the limits applied to them.
- Saved state and wake reservations — Keep saved records separate from the in-memory holds used while delivering a wake.
- Workbench — Load and update the ticket store used by the Bridge.
- Open, save and retire records — Recover the last committed state and keep the file bounded.
- Restore context after 瞳 compacts — Save each new checkpoint before asking the hook to restore context.
- Schedule RSI reviews — Track eligible material and open a review when the configured group is due.
- Track stalled tickets — Record reminders and escalations so the Bridge can avoid repeating them.
- Look up routing and delivery history — Find tickets, recent replies, role recipients and saved verify-gate result paths.
- Create tickets and record checkout results — Hold delivery until a requested worktree is ready.
- Read and deliver tickets — List work, record delivery and transfer unfinished tickets when a member changes rooms.
- Complete or cancel tickets — Save the state change together with any notice it produces.
- Reserve and acknowledge wakes — Count recent wakes and prevent two delivery attempts from owning the same ticket.
- Find checkouts and manage claims — List a group’s open work, active claims and the worktrees a room can use.
- Format tickets, wakes and hook replies — Present routing and completion evidence in the form the recipient’s CLI expects.

### `bridge/groups.ts`

- Group and roster definitions — Keep group records and roster messages consistent.
- Check group records — Keep invalid data out of groups.
- Save and load groups — Keep group changes on disk and give callers safe copies.
- Manage groups and members — Change which rooms belong together and how groups are ordered.
- Change the name or board — Keep the group's display settings up to date.
- Set roles and choose a lead — Give each room its responsibilities and directions.
- Share the roster — Give rooms the context they need to work together.

### `bridge/handoff.ts`

- Share command results — The CLI prints the lines and exits with 0 for success, 1 for failure, 2 for usage or 3 for a rule stop.
- Choose rooms for native tests — The workspace list stores the Founder's preferred rooms, and group roles can also designate rooms.
- Find and list rooms — Match room names and identifiers, then show state, permission mode and native-test rank.
- Read dispatch quotas — Routing uses the reported allowance, while the CLI displays whole percentages.
- Connect to the Bridge — Keep the room snapshot current and wait for replies on the same connection.
- Send a direct handoff — Resolve a recipient and check room readiness before sending a message.
- Read the latest room activity — Show recent messages, pending prompts and an optional screen tail.
- Run workbench commands and wake recipients — The reservation fixes the recipient. Older Bridges return a legacy ping.
- Read recent handoff outcomes — The CLI can request only failed entries.

### `bridge/room-replace.ts`

- AGY metadata and conversation forks — copy a conversation and update its identity and folder.
- Folder validation and Claude memory — check the destination and optionally copy its memory files.
- Replace a stale room and hand over its work — preserve group membership and pending tickets.
- Move a room and adopt its session — fork into the destination and bind its new identity.

### `bridge/rooms.ts`

- Runtime state — See LiveRoom, the fields at the start of Rooms, and timing fields beside their methods.
- Input diagnostics — Record input timing and outcomes without saving message or screen text.
- Prompt policy — Tell a room on its first eligible prompt that it is working alone.
- Attachment request validation — Accept older image requests and enforce the current file and image limits.
- Usage and model catalogue — Refresh quota readings, daily history and the models shown in pickers.
- Room records — Create room records and keep their recent conversation.
- CLI launch arguments — Build each CLI's flags for room settings, session state and workbench hooks.
- Group wake — Check whether a group room can open and prevent duplicate live sessions.
- Room model settings — Track each room's model, effort and speed and apply saved choices when it opens.
- Room identity and storage — Link rooms to native sessions and preserve room settings across restarts.
- Transcript watching — Watch native session files and update room history as they change.
- Room lifecycle — Start, resume, fork and close room terminals while keeping their session links.
- Screen refresh — Read terminal output and update room readiness, menus and pending cards.
- Answer terminal cards — Send question answers and approval decisions through the terminal.
- Send input — Prepare attachments, send or defer input and verify what reached the terminal.
- Remote Control — Read room connection state and manage the Mac's Codex Remote Control setting.
- Archive idle rooms — List idle rooms and recheck the selection before archiving.
- Delete archived rooms — Check transcript ownership before removing rooms and moving eligible files to the Trash.
- Handle client requests — Check incoming room events and dispatch them against the current room and terminal state.

### `bridge/sessions.ts`

- Session records and locations — Identify saved sessions and where to find them.
- Read saved conversations — Load the messages and details a room needs.
- Read questions and answers — Show what the agent asked and how the user replied.
- Read progress checklists — Show the latest recorded work steps.
- Estimate context use — Show how much of the agent's context is in use.
- Put messages in order — Keep room notes and saved messages in one conversation.
- Watch session files — Refresh rooms when their files change.
- Check working folders — Resolve room folders and check path boundaries.

### `bridge/terminal.ts`

- Read approval prompts — Identify the request and its responses.
- Read menus and confirmations — Identify the menu and how to use it.
- See work in progress — Detect active work and background tasks.
- Find the live input box — Read the draft and recognize the prompt.
- Read model and quota — Find the selected model, effort and allowance.
- Read question choices — Identify options, the cursor and free-text answers.
- Find resume and session details — Recognize a resume prompt or read a session ID.

### `scripts/source-map.ts`

- Read tracked source files — Find section names and their existing descriptions.
- Update the source map — Replace only the generated block or check its freshness.

### `server.ts`

- Startup configuration and locks — Load local settings and check the UI build, checkout, workspace and port before wiring Bridge services.
- Transcription availability — Keep the advertised transcription capability current as the local Whisper installation changes.
- Restart and process settings — Wire the launchd restart controller and expose the workspace and skill paths to child processes.
- Shared request state — Keep storage scans, read marks and media links in one place and resolve the pairing key before admitting clients.
- Network identity and socket delivery — Resolve request scope, discover the Tailscale address and limit queued data when sending events.
- Room events and recovery — Send room updates to clients and reconcile group membership and idle timers after room changes.
- Push notifications and Inbox alerts — Track which devices need notices and scan the Inbox for new alerts.
- Room settings and replacement — Load room defaults, handle stalled Claude resumes and connect the GitHub and Drive panels.
- Group membership and room presence — Track who is viewing each room and reconcile the room watchers when the roster changes.
- Workbench services — Connect ticket routing, room successors and worktree capacity to the workbench.
- File triggers and notices — Maintain observers against signed settings and deliver pending file notices to group leads.
- Delivery holds and RSI scheduling — Keep rooms open during delivery and dispatch eligible RSI review work.
- Group closeout and workbench maintenance — Close idle group rooms, deliver completion notices and wake rooms with pending work.
- HTTP and WebSocket admission — Check the request scope, pair remote clients and send the initial Bridge state.
- WebSocket services and views — Handle service requests and update the current room or group view after pairing.
- WebSocket groups, rooms and panels — Route group and room changes, along with requests from their supporting panels.
- WebSocket file triggers and terminal input — Validate trigger and group settings before falling through to the room's terminal event handler.
- Vite development server — Set up Vite middleware and its HMR socket on the existing HTTP server.
- Local CLI workbench hook — A CLI hook asks for its agent's new tickets. Only from this Mac; any failure answers "nothing" so a hook never breaks the CLI.
- Web interface delivery — Serve the branded shell and assets from Vite in development or from the built UI.
- Before listening — Restore group rooms, discover the network address and start attachment housekeeping.
- After binding the port — Recover persisted work and start the transcript and trigger watchers once this process owns the listener.
- Maintenance and shutdown — Refresh trigger and socket health during operation, then release services when the process stops.

### `src/App.tsx`

- App entry and confirmation provider — Give the guild interface a shared confirmation dialog.
- Room state and gestures — Track the room inventory and read marks alongside context-menu gestures.
- Group state, roles and tools — Keep the active room and group selection alongside their role, board and trigger controls.
- Bridge capabilities and panel state — Store connection capabilities before exposing the file, worktree, push and composer controls.
- Sound, alerts and room lifecycle — Unlock audio on user input and track the visible alerts and room lifecycle dialogs.
- Room updates, drafts and action feedback — Keep what the composer and room list show in step with Bridge replies.
- Incoming Bridge events — Handle snapshots, updates and request replies in one socket callback.
- Image previews, push and disconnect cleanup — Route notification taps to rooms or the Inbox and clear pending UI state on disconnect.
- Sending, group changes and panel requests — Send commands and panel requests over the active connection.
- Room and group visits — Keep history, the selected recipient and draft presence tied to the active view.
- Composer, room actions and attention — Share input and approval handling between room views and route attention to the right room.
- Single-room terminal and controls — Wire the selected room's terminal and CLI controls for both phone and desktop.
- Phone room navigation — Reuse the character strip and room search in the hall and conversation views.
- Guild shell and top bar — Share file, GitHub and image opening across the guild and keep alerts above the active view.
- Pairing, hall and room views — Choose pairing, the guild hall, a group or a single room.
- Room actions and archive — Show the room menu, rename form and archive controls.
- Group dialogs, settings and panels — Mount group tools, settings and room lifecycle dialogs.

### `src/components/ControlBar.tsx`

- Build shared controls — The composer and room toolbar share button styling and press feedback.
- Show context use — The ring and tooltip use the same clamped percentage.
- Render the composer controls — The phone and group dock fill their available width while the desktop bar can wrap.

### `src/components/EmptyRoomState.tsx`

- Empty room welcome — Show the stage and pinned rooms for the selected character.
- Character portraits and colors — Pick role-specific artwork and accents.
- Portrait animation — Draw blinks, smiles and lantern light over each portrait.
- Idle quotes — Set the pace and order for the greeting lines.

### `src/components/GroupChat.tsx`

- Create a group — The creation form accepts both new CLI rooms and existing sessions.
- Order messages across rooms — Use dates to merge room histories and place undated entries near their neighbours in the same room.
- Read and respond in a group — Show the shared conversation and route drafts, questions, and commands to the addressed room.

### `src/components/GroupRoomSidebar.tsx`

- Identify groups and rooms — The group icon shows which models are present, and the lead heads the member list.
- Show ticket transfers — Workbench events drive the overlays on the member avatars.
- Show member avatars and badges — Both layouts use the same avatar to show activity, pending decisions, leadership and assigned roles.
- Render the group sidebar — The compact strip shows the current group's members, while the wide sidebar also lists groups.

### `src/components/GuildHallHome.tsx`

- Guild Hall welcome — Show the illustrated landing page and room status.
- Choose a group on mobile — Open a group from the edge of the screen.

### `src/components/GuildModals.tsx`

- Create a room — Set up a character and workspace for a new room.
- Move a room — Change the working folder of an existing room.
- Check quota use — See today’s usage and when quotas reset.

### `src/components/LeftCharacterMenu.tsx`

- Set the role order and selected-room colours — The order matches the desktop room shortcuts.
- Show the roster and room list — The sidebar gives desktop users access to groups, role usage and room activity.

### `src/components/LiveTerminal.tsx`

- Render terminal text — Styled spans are interleaved with plain text so the screen stays selectable.
- Start, end or open remote CLI sessions — The room toolbar uses compact controls on phones and inline actions on desktop.
- Display the live terminal and send keys — Menu prompts can open the panel, while manual keys depend on the current room state.

### `src/components/MessageBubble.tsx`

- Set bubble defaults — User and agent bubbles share a shadow, and handoff notes use their own folding limit.
- Separate message days — The timeline uses the same date divider in group and single rooms.
- Show user text and Bridge notes — The Bridge roster can expand independently of the user's message.
- Fold long agent replies — Mount an interactive preview until the user opens the full reply.
- Render a message — Single and group rooms share this bubble, with the speaker and time at the start of each message run.

### `src/components/ModelEffortPicker.tsx`

- Normalize model names and label effort levels — CLI model names can arrive with different case and punctuation.
- Keep the picker menu in sync — Room changes, disabled controls and outside input can close the menu.
- Find the options for this room — Each CLI reports model names and supported efforts in its own format.
- Choose a model with a tap or a slide — Sending a choice clears the gesture state for either picker.
- Choose an effort level on the track — Dragging previews a stop and releasing sends that effort to the room.
- Place and render the picker — The menu follows the trigger but renders above the composer.

### `src/components/RightRoomWorkspace.tsx`

- Copy room details — Report the result of copying the full repository path or session ID.
- Show and control a room — The desktop workspace keeps the selected room's transcript, terminal controls, and composer together.

### `src/components/SettingsModals.tsx`

- Shared dialog and switches — Give the dialogs consistent controls.
- Appearance and languages — Choose the theme, display language and voice input language.
- Notifications — Set up lock-screen alerts.
- Room defaults and compaction — Choose how rooms start and manage their context.
- Restart the Bridge — Explain the interruption before restarting.
- Settings dialog — Bring all the settings together in one place.
- Phone connection — Open the Bridge from another device.

### `src/components/WorktreePanel.tsx`

- Shared panel controls — Keep the display helpers, button styles, and edge gesture distances together for the panel views.
- Load worktree data — The diff, file browser, and picker use the same loading and error states.
- Show diffs and files — Both views read from the selected worktree and reload when the user refreshes the panel.
- Choose a worktree — Keep the saved choice per room and let the user search linked worktrees.
- Open and close the room panel — Keep panel gestures, keyboard dismissal, and the selected room and tab in the enclosing layer.

### `src/types/bridge.ts`

- Describe launch modes and terminal keys — The CLI and Bridge use these types for approval settings and named terminal inputs.
- Route workbench tickets and record handoffs — The receipt records how a room was selected, and the wake record pins that recipient.
- Describe file triggers and worktrees — These types give the group and repo panels the data returned by the Bridge.
- Receive requests from clients — Each request identifies the action and includes the inputs the Bridge needs.
- Send state and results to clients — The initial snapshot advertises capabilities. Later events report updates and request results.

### `src/types/guild.ts`

- Identify CLI roles and groups — Groups name their members by room and can assign a role and lead.
- Describe pending approvals and questions — The Bridge records prompts the room cannot continue past until someone responds.
- Record conversations and task steps — A transcript row can carry a question, an attachment or the latest checklist.
- Describe the state of a terminal room — Room snapshots combine the CLI session, current screen and conversation.
- Describe a character and its usage — The roster uses this profile for presentation, model options and quota history.

### 未整理

- `bridge/access.ts`
- `bridge/archive-groups.ts`
- `bridge/attachment-trash.ts`
- `bridge/attachments.ts`
- `bridge/auto-compact.ts`
- `bridge/auto-worktree.ts`
- `bridge/bench-completion.ts`
- `bridge/bench-experience.ts`
- `bridge/bridge-restart.ts`
- `bridge/config.ts`
- `bridge/drive-io.ts`
- `bridge/drive.ts`
- `bridge/file-reader.ts`
- `bridge/file-trigger-config-monitor.ts`
- `bridge/file-trigger-confirm.ts`
- `bridge/file-trigger-delivery.ts`
- `bridge/file-trigger-keychain.ts`
- `bridge/file-trigger-reset-key.ts`
- `bridge/file-trigger-resume.ts`
- `bridge/file-trigger-shutdown.ts`
- `bridge/file-trigger-store.ts`
- `bridge/file-trigger-test-anchor.ts`
- `bridge/file-trigger-unlock.ts`
- `bridge/file-trigger-watch.ts`
- `bridge/folder-setting.ts`
- `bridge/github.ts`
- `bridge/group-closer.ts`
- `bridge/group-views.ts`
- `bridge/handoff-log.ts`
- `bridge/images.ts`
- `bridge/inbox-alerts.ts`
- `bridge/inbox.ts`
- `bridge/input.ts`
- `bridge/launch-modes.ts`
- `bridge/media.ts`
- `bridge/pairing.ts`
- `bridge/persona-notice.ts`
- `bridge/pins.ts`
- `bridge/presence.ts`
- `bridge/push.ts`
- `bridge/read-mark-store.ts`
- `bridge/room-blocker.ts`
- `bridge/room-protection.ts`
- `bridge/screen.ts`
- `bridge/skills.ts`
- `bridge/storage-usage.ts`
- `bridge/stuck-log.ts`
- `bridge/successors.ts`
- `bridge/terms.ts`
- `bridge/traditional.ts`
- `bridge/transcribe.ts`
- `bridge/usage-history.ts`
- `bridge/usage.ts`
- `bridge/workspace-lock.ts`
- `bridge/worktree.ts`
- `scripts/bench-acceptance.ts`
- `scripts/bench-experience.ts`
- `scripts/bench-hook`
- `scripts/komorebi-bench-plugin.sh`
- `scripts/komorebi-restart.sh`
- `scripts/komorebi-room`
- `scripts/komorebi-room.ts`
- `scripts/komorebi-service.sh`
- `scripts/komorebi-skills`
- `scripts/komorebi-skills.ts`
- `scripts/make-icons.py`
- `scripts/preview-voices.mjs`
- `scripts/restart-bridge.command`
- `scripts/start-bridge.sh`
- `scripts/task-context.ts`
- `scripts/ui-copy-smoke.mjs`
- `scripts/ui-smoke.mjs`
- `scripts/verify-gate.ts`
- `src/brand.ts`
- `src/components/ApprovalDiff.tsx`
- `src/components/AttachmentPicker.tsx`
- `src/components/AvatarExpression.tsx`
- `src/components/BotanicalAccents.tsx`
- `src/components/CharacterSpriteAnimator.tsx`
- `src/components/ConfirmDialog.tsx`
- `src/components/CopyTurnButton.tsx`
- `src/components/FilePicker.tsx`
- `src/components/FileTriggerBanner.tsx`
- `src/components/FileTriggerDialog.tsx`
- `src/components/FileViewer.tsx`
- `src/components/FolderPicker.tsx`
- `src/components/GroupBoardMenu.tsx`
- `src/components/GroupMemberRoleEditor.tsx`
- `src/components/GroupSwipeHint.tsx`
- `src/components/GuildActions.tsx`
- `src/components/GuildQuestBoard.tsx`
- `src/components/HistoryNote.tsx`
- `src/components/ImagePreviews.tsx`
- `src/components/InboxPanel.tsx`
- `src/components/Markdown.tsx`
- `src/components/PermissionButton.tsx`
- `src/components/PetalMenuIcon.tsx`
- `src/components/PullIndicator.tsx`
- `src/components/QrCodeMatrix.tsx`
- `src/components/QuestCard.tsx`
- `src/components/QuestionCard.tsx`
- `src/components/RejectReason.tsx`
- `src/components/RoleCard.tsx`
- `src/components/RoomAlerts.tsx`
- `src/components/RoomPin.tsx`
- `src/components/SlashCommandMenu.tsx`
- `src/components/StepsChecklistCard.tsx`
- `src/components/StorageUsage.tsx`
- `src/components/VoiceButton.tsx`
- `src/components/WorkingIndicator.tsx`
- `src/components/drive/DrivePanel.tsx`
- `src/components/drive/views.tsx`
- `src/components/github/GitHubPanel.tsx`
- `src/components/github/SearchPicker.tsx`
- `src/components/github/views.tsx`
- `src/components/groupRoleIcons.ts`
- `src/data/cliCommands.ts`
- `src/data/initialGuildData.ts`
- `src/i18n/characterName.ts`
- `src/i18n/en.ts`
- `src/i18n/index.ts`
- `src/i18n/ja.ts`
- `src/i18n/serverNotice.ts`
- `src/i18n/useLang.ts`
- `src/i18n/zh.ts`
- `src/index.css`
- `src/main.tsx`
- `src/types/groupRoles.ts`
- `src/utils/approvalChoices.ts`
- `src/utils/attentionDiff.ts`
- `src/utils/audioSession.ts`
- `src/utils/bridgeNote.ts`
- `src/utils/bridgeRestart.ts`
- `src/utils/bubbleRuns.ts`
- `src/utils/fileAttachments.ts`
- `src/utils/fileOpen.ts`
- `src/utils/filePaths.ts`
- `src/utils/fileUpload.worker.ts`
- `src/utils/focusScope.ts`
- `src/utils/ghClient.ts`
- `src/utils/ghPrefs.ts`
- `src/utils/githubLinks.ts`
- `src/utils/githubOpen.ts`
- `src/utils/githubUrl.ts`
- `src/utils/googleLinks.ts`
- `src/utils/groupBoard.ts`
- `src/utils/groupRecipient.ts`
- `src/utils/groupSwipe.ts`
- `src/utils/history.ts`
- `src/utils/imagePaths.ts`
- `src/utils/launchMode.ts`
- `src/utils/micCapture.ts`
- `src/utils/pendingAge.ts`
- `src/utils/petals.ts`
- `src/utils/prepareFileUpload.ts`
- `src/utils/prepareImage.ts`
- `src/utils/previewLoader.ts`
- `src/utils/pullRefresh.ts`
- `src/utils/pushClient.ts`
- `src/utils/questNotice.ts`
- `src/utils/reorder.ts`
- `src/utils/roleAccent.ts`
- `src/utils/roleEditorSave.ts`
- `src/utils/roomAttention.ts`
- `src/utils/roomUi.ts`
- `src/utils/scrollFollow.ts`
- `src/utils/soundPlayer.ts`
- `src/utils/terminalScroll.ts`
- `src/utils/theme.ts`
- `src/utils/transcriptText.ts`
- `src/utils/useAutosize.ts`
- `src/utils/useBridge.ts`
- `src/utils/useConversationScroll.ts`
- `src/utils/useDragReorder.ts`
- `src/utils/useGroupSwipe.ts`
- `src/utils/useKeyboardViewport.ts`
- `src/utils/usePush.ts`
- `src/utils/voice.ts`
- `vite.config.ts`

<!-- source-map:end -->
