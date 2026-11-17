# Flow reference attachment gate (partial #388)

Image generation no longer treats the fixed post-file-assignment delay as proof
that references are attached. Immediately before returning the Create control,
the prompt loop requires the exact requested number of visible, decoded images
in the recognized prompt composer, with no visible progressbar or aria-busy
state. It uses the existing request deadline. A missing/changed composer,
incomplete images, too few/many images or busy uploads time out without clicking
Create. Text-only generation does not require attachment support.

The probe is deliberately limited to `flow-rich-text-editor` / `.prompt-input`
around the explicitly recognized ProseMirror prompt. It does not count document
images, generated results, or library tiles. The worker refuses to start a new
reference upload if that composer is unrecognized, busy or already contains
images, rather than clearing user media or letting old chips satisfy the count.
Both CDP and DOM upload paths use the same gate and existing cleanup.

This is a conservative DOM contract, **not live Flow compatibility evidence**.
Tests execute the injected count expression against synthetic composer fixtures
and exercise the full image worker with mocked state reads and input events.
Current Flow may render chips outside these containers or use different pending
indicators. Such a layout must be verified with sanitized live DOM fixtures;
unsupported layouts fail closed rather than generating without references.
The count check is not checksum identity/order verification: it depends on the
ordered upload path and an initially empty composer. It must not be reused as
proof of exact library-media identity.

## Remaining #388 acceptance

- Verify actual pending/completed chips, localized UI and errors in live Flow.
- Implement exact checksum-named library selection with collision/missing-item
  fallback and order/duplicate tests. Do not reuse by display name alone.
- Add slot-specific Start/End/component-video readiness. The video worker still
  has its old post-upload wait; this image-only slice does not fix it.
- Prove second-run library reuse without uploading bytes.

No live account, upload, generation, native-device or provider operation was
performed for this slice. No filenames, checksum names, prompts, paths or media
URLs are added to progress reporting. Keep #388 open.
