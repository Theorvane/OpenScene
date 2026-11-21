# OpenScene development

Follow AGENTS.md for architecture, security, compatibility identifiers and verification.

The product edits imported media through Timeline and Canvas modes. Main-process services own files, credentials, FFmpeg, transcription and tool execution. Desktop and mobile share editing rules in src/shared.

Run root typecheck, tests and build, plus mobile typecheck. Existing project codecs must preserve imported assets and timelines from earlier versions.
