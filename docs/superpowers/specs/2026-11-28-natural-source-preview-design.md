# Natural workspace source preview

Approved by the user: selecting a video shows the full original video and a source timeline within natural mode. The app opens natural editing directly, skipping project selection. Desktop supports empty intake and creates a project via the existing local folder flow at first import. Existing projects remain reachable through the workspace list or folder button. Mobile opens Agent for the latest local project or a new empty project.

## One transport and separate source lanes
The latest user request removes native controls from the video image. A single custom transport below the image supplies play/pause, first/last position, five-second backward/forward jumps, mute and source seeking. Aligned video, sound and subtitle lanes share the original source clock. Subtitle clips come from the selected review job only when project and asset identities match. Do not trigger transcription or synthesize captions or waveforms. Unknown audio state stays explicit when the runtime cannot report embedded audio. Mobile uses the same source-track builder with platform playback and custom controls.

## Alternatives and boundaries
Switching to precision hides the natural workflow. Automatically inserting clips changes the saved edit. Instead, source-only playback is read-only and never adds or modifies timeline clips. Native media controls duplicate the custom timeline, so they are disabled. Preserve originals, import cancellation, project switching, explicit analysis/start approvals and compatibility identifiers. Only this session implements and reviews; no second implementing session.

FFmpeg scope clarified by the user: install on this computer for local running/tests only. No app-level automatic installation feature. FFmpeg and FFprobe 9.1 were installed through Homebrew.
