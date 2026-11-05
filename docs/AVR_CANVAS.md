# AVR project workspace

UARTDebug targets desktop and laptop browsers. The desktop workspace has four panes: Chat, Project Specification, C Code, and Code Description, in that order. The first visit has no selected project or automatic main.c. New project creates an empty draft.

The project/file list opens in a standard modal from the Files button in the upper middle target panel. It retains project selection, creation, import, export and file actions without occupying a permanent workspace column. Chat occupies the former left file-list pane; the specification remains a separate editable document.

## Canonical project structure

The private Sergey-Bulanov/UartDebug2 repository defines project rules and technical knowledge. Its tracked files remain unchanged on the server. A target project has its own folder under Target_Projects; versions use Name Ver.X.Y when needed to distinguish projects.

- Name.md: editable project specification.
- Name.c: C source.
- Name.yaml: internal resources and dependencies.
- Name (description).md: description of the actual code, when present.

Internal YAML and AI files do not appear in the user file list or code editor. They remain available to AI, import and account synchronization. Logical project filenames are separate from storage keys so independent projects can use the same names. Legacy source content is preserved during migration; old question answers become inline Markdown remarks once.

## Chat and project actions

The workspace sends natural-language requests to `POST /api/avr/ai/chat`, with the current specification, selected target, relevant project artifacts and bounded conversation history. The assistant chooses whether to answer, edit requirements, generate code or describe the current program. No operation selector is required.

| Chat action | Result | Allowed output |
| --- | --- | --- |
| reply | Conversation answer or question | Message only; no artifact changes |
| clarify | Specification review or authorized edit | Complete specification and chat message |
| generate | Create or update the requested program | Authorized specification, C source and hidden resource YAML |
| describe | Describe the supplied current C | Markdown description; specification, C and resources stay unchanged |

A complete user request can create a specification and generate its code together, including from an empty draft. Missing decisions are asked in the chat instead of inserting new inline Question blocks. Existing document remarks and user answers remain unless an authorized specification edit changes them. Protected user C regions remain byte-for-byte unchanged. A generation response does not also invent or update a code description; that is a separate requested action.

Review specification is an application shortcut into the same chat. It sends `requestSource: "review"`, which limits the response to a reply or specification review. The English shortcut text does not choose English for the response: an existing specification language, natural user messages and the document's language retain their precedence. Normal typed messages use `requestSource: "message"` and determine the conversation language. Artifact language remains separate and preserves an explicit project language.

`POST /api/avr/ai/canvas` retains the explicit `analyze`, `generate` and `describe` contract for existing integrations. Its review uses inline Markdown remarks; its generation preserves the input specification exactly. The chat transport is an explicit adaptation of those constraints: an authorized chat generation may also author the requested specification. Both transports share canonical materials, resource/code validation, compiler verification, access checks and usage accounting.

Code Description uses the same directly editable live Markdown behavior as Project Specification. It has no Edit/Preview toggle or action capsule. Edits are saved with the project workspace.

An empty specification is valid. The agent asks for missing identity, version, target or behavior instead of inventing them. Code generation requires unambiguous hardware and project identity in the resulting specification; an explicitly selected target cannot be silently overridden. Description preserves specification, C and resources.

The model receives AGENTS.md, AGENTS_Add_On.md, Project_Description.md and Base_project_rules.md completely, once, followed by applicable knowledge entry points. Bounded local retrieval follows repository pointers. Notes, temporary artifacts, protected Problems.md files and unrelated target projects are excluded. Each request pins one immutable materials release.

## Desktop workspace

AI answers and progress appear chronologically in Chat. Chat errors also use the shared notification surface so their details remain available. Compiler and UPDI results, import feedback, storage/account messages and UART action errors use the same notification module. A short toast opens the notification dialog with actionable details. JavaScript stacks, protocol logs and internal errors go only to browser DevTools and are not retained in notification history. The notification button is temporarily placed in the target panel beside Files and opens the same dialog as a history view. Compilation and flashing update one operation record instead of adding a toast for each log line or progress stage. Background account feedback has its own record and cannot finish an active operation.

Stop ends browser-side receipt of the current chat response and prevents its later artifact changes from being applied. It does not guarantee cancellation of an already running provider call: server processing and usage accounting may still finish. This action does not roll back changes already applied before it was pressed.

Chats opens the project's complete conversation list inside the existing pane, ordered by recent activity. Each record includes a visible menu for rename, download Markdown and delete with the shared confirmation; the current conversation has the same menu. Search, pinning and archiving are removed. Previously archived conversations reappear in the ordinary list. New chat creates a separate history and composer draft, reusing an already empty automatic chat instead of filling history with empty copies. Automatic titles come from the first user message; a manual title is preserved. Deleting the final chat leaves one empty chat and keeps project files. Switching or starting a chat stops the current response before late changes can be applied. The compact pane retains its noninteractive Chat label and reopens through the shared separator. The composer keeps its model label directly beside Send in one row; a long project name truncates on the left.

Messages support copying their Markdown, copying individual code blocks, retrying a failed response, and branching from a chosen point. Retry reuses its user turn and retains any unrelated composer draft. Edit copies the conversation before the selected user message into a new chat and sends the edited message there; later messages remain only in the intact original chat. Regenerate likewise creates a separate chat for its alternative response. These actions use the current project artifacts; they do not restore an older specification or program. Review retries and regenerated reviews keep the review-only action guard, while edited user text is a normal message. The history and message interactions take their reference from [ChatGPT projects and chats](https://learn.chatgpt.com/docs/projects?surface=app), adapted to the desktop editor's narrow pane and shared project files. Voice, public sharing, extra model choices and multimodal uploads are not simulated by controls that lack backend support.

The upper connection panel distinguishes the selected serial adapter from the chip signature read through it. This is the last successful reading, not a permanently open connection: UPDI closes the port after each operation. The adjacent project-target panel shows whether its MCU comes from Auto detection, was chosen manually, matches the detected chip or differs from it. Auto keeps its mode while displaying the resolved chip name; a manual choice survives detection and errors. Detection is invalidated when a new reading starts, the adapter changes or disconnects, or a communication error occurs. Rechecking the same chip keeps its selected package. Flashing rejects a manual target mismatch before erase or programming and keeps the successful signature visible for diagnosis.

Notification history is bounded and stored in `sessionStorage` for the browser tab, so it survives a reload within that session. Dismissing a toast keeps its history entry. The history is separate from project/account synchronization. The old compiler-log subpanel and inline operation-message areas are removed from the workspace. Connection state, target selections, credits and UART data remain in their existing controls and views.

The project/file list, confirmations, account settings, project import and notification details share the modal surface in `ui-controls.css` and the focus stack in `ui-controls.js`. Confirmations that require a decision remain modal; informational feedback opens details only when requested.

Window outlines retain the established smooth action capsules and matching curved cutouts. The drawing used to discuss placement is a schematic, not a specification for literal diagonal construction lines. Capsules retain their button size and vertical arrangement when panes collapse; complementary narrow and wide sections use matching widths.

## Shared desktop UI

All site windows use the foundation in `ui-controls.css`: `ui-panel` owns the frame, `scroll-frame` adds editable-content focus, and `ui-scroll-region` owns scrolling and the readonly keyboard focus indicator. These apply to AVR connection/target/account panels, Chat, specification/code/description, UART connection and TX/RX panels, logs, generator and graph surfaces, dialogs, project menus, select and completion popups, notifications, home cards and legal documents. Existing dialog and third-party completion classes adapt to that same foundation; no additional wrapper or application framework is introduced. Tooltips and chat-message bubbles remain content widgets in their existing shared components.

Each component owns its border, radius, background and shadow settings. Nested components inherit theme tokens, but reset the parent's per-component settings, preventing a dialog's raised shadow or radius from leaking into its inner editor. Page styles retain geometry, typography and explicit variants. Capsule-shaped AVR windows keep their existing SVG outlines; their transparent rectangular shell is configured through the same frame parameters.

AVR (including Chat) and UART use one `bindPanelResizer` implementation for primary-pointer filtering, handle focus, capture/fallback listeners, keyboard direction/endpoints/Shift, and cleanup on pointer release, cancellation, lost capture, blur or window resize. Geometry, collapse thresholds, animation and persistence remain workspace-specific adapters. UART resizing begins from its existing size rather than jumping to the press position. AVR editor measurement completes before the movement animation starts.

History labels and inline message edits use that same text-motion adapter. A framed text area separates its fluid `scroll-frame` from the embedded text layer; the latter keeps its wrapping while the frame changes size. The native text area's old scrollbar is hidden during the transition. This avoids freezing a whole row or leaving an old field border inside an expanding pane.

At an expanded AVR pane's minimum width, a soft directional wave previews further dragging to collapse. Compact panes do not play this cue. Reduced-motion mode shows a still gradient instead; opening and closing retain their existing shared size transitions.

Specification and description use one `createMarkdownDocumentEditor` constructor, one Markdown mode configuration and one `markdown-live-editor` style set. Formatting styles apply only to `is-markdown-live` editors, preserving C syntax colors. Native and CodeMirror-drawn caret/selection states share the same palette. The code gutter has an opaque background so horizontally scrolled source cannot paint over line numbers. Library styles load before application styles.

Content and persistence remain specific to each pane: a specification can exist as a draft, while a description requires a linked guide file. Read-only states enforce that distinction in both enhanced and fallback editors. Chat has its own message/composer content inside the shared workspace resizing behavior.

Shared controls own selection popups, disabled states, focus preservation during option updates and modal focus containment. Project actions dismiss before their parent dialog and restore their trigger's focus. UART checkbox/radio controls retain native keyboard interaction; disconnected sessions are inert for both keyboard and pointer input.

The desktop browser suite checks these contracts through actual focus, typing, selection, keyboard scrolling, resizing, popup updates and UART writes. It probes shared frame parameters on all five page routes and nested components, compares related editor surfaces in equivalent states, includes the textarea fallback, and checks pixels for code leaking under line numbers. Shared pointer-lifecycle unit tests cover capture failure and every cancellation path. These tests run with the existing desktop-browser CI job and unit suite. Rendered expanded, compact and transitional states still require visual review.

## Validation and storage

The server validates structured output before application. Resource YAML contains ordered microcontroller, hardware_resources and software_dependencies mappings with full include directives; duplicate keys, aliases and custom tags are rejected. C checks cover project identity, required regions, xc.h as the first directive, main/loop structure and exactly preserved user region contents. Generated C is compiled with bounded repair attempts. Compilation does not establish hardware correctness.

The browser rejects responses if the account, selected project or chat, specification revision, target or relevant project contents changed during the request. Partial stage output is merged into the current project.

The browser and account save one schema-3 project-workspace envelope: source, descriptions, hidden YAML, per-project specification/target/authorship, assets, metadata and current selection. Each project's chats are stored in `miniProjects[instanceId].conversation` as `{schemaVersion: 4, activeThreadId, threads: [{id, title, messages, draft, titleMode}]}`. User messages may retain `requestSource` to preserve the review action guard on retry. The unfinished `draftCanvas` and `draftConversation` belong to the same envelope. Older single conversations and collections migrate without dropping their messages or drafts; schema-3 archive and pin flags are discarded without removing the conversations themselves. Each project supports up to 32 chats and 100 messages per chat. Collections retain the 256 KiB per-chat and 2 MiB content budgets through canonical legacy projections that exclude bounded management metadata, request-source flags and default complete statuses. The 4 MiB raw workspace limit remains absolute; if migration metadata exceeds it, saving reports an explicit recoverable error rather than trimming history to fit. A received answer stays available to copy if saving fails; deleting an older chat can free space while preserving that active answer and draft. Moving the draft chats into a newly created project writes both changes in one workspace save. Request history is independently bounded. Restored pending responses become interrupted states rather than resuming a request; an empty interrupted response uses a UI fallback instead of adding generated text to stored content.

The account route retains its `files` name for compatibility, with one server revision and one identity/conflict/recovery flow. Conversation changes use that same atomic save; they do not introduce a separate chat store or synchronization route. Older schema-3 snapshots without conversation fields remain readable. Once a project's or draft's chat format is upgraded, older clients cannot downgrade it or erase newer management metadata: such writes receive a refresh-required conflict. No separate instruction save runs in the current browser.

Legacy file and instruction records are read only for migration. Existing project canvases, including explicitly empty ones, take precedence; only the formerly active project lacking a canvas can inherit the old shared instruction. The first consolidated write checks both the file revision and `expectedLegacyInstructionRevision` atomically. After that write, legacy file-schema and standalone-instruction writes are rejected. Legacy instruction records remain available for migration/recovery and never override an explicit schema-3 draft. Historical chat rows remain on disk for recovery and are not imported or exposed by the active workspace API. The new `/api/avr/ai/chat` transport operates on the supplied project context; it does not reactivate that old storage. Deleting the final visible project clears that draft, cancels pending saves for the deleted project and saves the empty state. A newly typed draft still survives reload.

Curated examples are prepared from User_Examples during materials installation. Their functional C tokens are retained; structural markers and project metadata live in the derived `project-catalog.json` beside the mirror. Requests read the prepared catalog; they do not reconstruct examples. Canonical Target_Projects use the same output schema. Repository target samples require sign-in. Raw knowledge and rules are not public file routes.

See [materials deployment](AI_MATERIALS_DEPLOYMENT.md) and [AI service setup](../backend/AI-SETUP.md).
