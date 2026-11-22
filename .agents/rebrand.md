# Rebrand Notes

- User-facing product prose should say `OpenScene`.
- Do not rename package metadata, source identifiers, persisted storage keys, MIME types, IPC contracts, or environment variables during a docs-only rebrand.
- Avoid claiming a behavior changed unless source code changed and tests prove it.
- In docs, explain legacy compatibility names as compatibility identifiers, not as active product branding.
- A concept-wide documentation refresh may update DESIGN.md and architecture guides when requested. Keep runtime behavior and release identity unchanged unless separately authorized; distinguish implemented editing features from removed generation surfaces.
- Do not edit `DESIGN.md`, source code, tests, package metadata, or `index.html` for documentation-only rebrand tasks unless the user asks for that scope.
