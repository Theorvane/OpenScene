/** Counts only decoded, visible images in the known prompt composer, never library tiles.
 * Unknown DOM fails closed. This does not prove checksum identity or library reuse.
 */
export type GoogleFlowReferenceAttachments = {
  readonly visibleCount: number;
  readonly readyCount: number;
  readonly busy: boolean;
};

export function googleFlowReferencesReady(
  attachments: GoogleFlowReferenceAttachments | undefined,
  expectedCount: number
): boolean {
  return Number.isSafeInteger(expectedCount) && expectedCount > 0
    && attachments !== undefined
    && attachments.visibleCount === expectedCount
    && attachments.readyCount === expectedCount
    && attachments.busy === false;
}

/** Embedded inside the existing Flow state probe; returns counts/status only. */
export function buildGoogleFlowReferenceAttachmentsProbe(): string {
  return `(() => {
    const composer = explicitPromptEntry?.element.closest('flow-rich-text-editor, .prompt-input');
    if (!composer || !visibleRect(composer)) return undefined;
    const images = [...composer.querySelectorAll('img')].filter((image) => visibleRect(image));
    const busy = composer.getAttribute('aria-busy') === 'true'
      || [...composer.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some((element) => visibleRect(element));
    return {
      visibleCount: images.length,
      readyCount: images.filter((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0).length,
      busy
    };
  })()`;
}
