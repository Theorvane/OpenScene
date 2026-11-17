import { readFile, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareGoogleFlowReference } from '../src/main/googleFlowReference';
import { uploadReferencesThroughChromiumFileChooser } from '../src/main/chromiumFileChooserUpload';
import { REFERENCE_IMAGE_MAX_BYTES } from '../src/main/referenceImagePicker';
import type { ReferenceImageSelection } from '../src/shared/providerSeams';

const reference = (text = 'abc', displayName = 'private-client.png'): ReferenceImageSelection => ({
  displayName, mimeType: 'image/png', base64: Buffer.from(text).toString('base64')
});
const ABC_NAME = 'openscene-ref-v1-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.png';

afterEach(() => vi.useRealTimers());

describe('Google Flow content-addressed references', () => {
  it('uses the complete SHA-256 of decoded bytes, not source names or order', () => {
    expect(prepareGoogleFlowReference(reference()).fileName).toBe(ABC_NAME);
    expect(prepareGoogleFlowReference(reference('abc', '../../a secret.png')).fileName).toBe(ABC_NAME);
    expect(prepareGoogleFlowReference(reference()).bytes.toString()).toBe('abc');
    expect(prepareGoogleFlowReference(reference('abcd')).fileName).not.toBe(ABC_NAME);
  });

  it.each([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']])('uses the supported MIME extension: %s', (mimeType, extension) => {
    expect(prepareGoogleFlowReference({ ...reference(), mimeType }).fileName).toBe(ABC_NAME.replace(/png$/, extension));
  });

  it('normalizes padded and unpadded base64 to the same identity', () => {
    expect(prepareGoogleFlowReference({ ...reference(), base64: 'YQ==' }).fileName)
      .toBe(prepareGoogleFlowReference({ ...reference(), base64: 'YQ' }).fileName);
  });

  it.each(['', '?', 'Y', 'YQ=', 'YQ===', 'YR==', 'YQ==\n', 'YWJj='])('rejects invalid or empty base64 without revealing source metadata: %j', (base64) => {
    expect(() => prepareGoogleFlowReference({ ...reference(), base64 })).toThrow(/Google Flow reference image/);
    try {
      prepareGoogleFlowReference({ ...reference(), base64 });
    } catch (error) {
      expect(String(error)).not.toContain('private-client');
      expect(String(error)).not.toContain(base64 || 'private-client');
    }
  });

  it('rejects unsupported MIME types without reflecting them', () => {
    expect(() => prepareGoogleFlowReference({ ...reference(), mimeType: 'private-invalid/type' }))
      .toThrow('Google Flow reference image type is not supported.');
  });

  it('enforces the decoded byte limit, including the base64-length boundary', () => {
    const atLimit = Buffer.alloc(REFERENCE_IMAGE_MAX_BYTES, 1).toString('base64');
    expect(prepareGoogleFlowReference({ ...reference(), base64: atLimit }).bytes.length).toBe(REFERENCE_IMAGE_MAX_BYTES);
    const aboveLimit = Buffer.alloc(REFERENCE_IMAGE_MAX_BYTES + 1, 1).toString('base64');
    expect(() => prepareGoogleFlowReference({ ...reference(), base64: aboveLimit })).toThrow(/size limit/);
    expect(() => prepareGoogleFlowReference({ ...reference(), base64: `${aboveLimit}AAAA` })).toThrow(/size limit/);
  });

  it('preserves chooser order and duplicate content in private slots, cleans up, and emits counts only', async () => {
    vi.useFakeTimers();
    let listener: ((event: unknown, method: string, params: unknown) => void) | undefined;
    let files: string[] = [];
    const diagnostics: unknown[] = [];
    const debuggerApi = {
      isAttached: () => false, attach: vi.fn(), detach: vi.fn(),
      on: (_event: string, callback: typeof listener) => { listener = callback; },
      removeListener: vi.fn(),
      sendCommand: vi.fn(async (method: string, params?: { files: string[] }) => {
        if (method === 'DOM.setFileInputFiles') files = params!.files;
        return {};
      })
    };
    const operation = uploadReferencesThroughChromiumFileChooser(
      { debugger: debuggerApi } as unknown as WebContents,
      [reference(), reference('different'), reference('abc', 'renamed.png')],
      () => listener?.({}, 'Page.fileChooserOpened', { backendNodeId: 7, mode: 'selectMultiple' }),
      5_000, (details) => diagnostics.push(details)
    );
    // Filesystem staging is asynchronous real I/O; let it finish before advancing the delay timer.
    await vi.waitFor(() => expect(files).toHaveLength(3));
    await vi.runAllTimersAsync();
    const upload = await operation;
    expect(upload).not.toBeNull();
    try {
      expect(files.map((path) => basename(path))).toEqual([ABC_NAME, prepareGoogleFlowReference(reference('different')).fileName, ABC_NAME]);
      expect(new Set(files).size).toBe(3);
      expect(await Promise.all(files.map((path) => readFile(path, 'utf8')))).toEqual(['abc', 'different', 'abc']);
      if (process.platform !== 'win32') {
        expect((await stat(files[0]!)).mode & 0o777).toBe(0o600);
        expect((await stat(dirname(files[0]!))).mode & 0o777).toBe(0o700);
      }
      expect(JSON.stringify(diagnostics)).not.toMatch(/private-client|renamed|ba7816|openscene-ref/);
    } finally {
      await upload?.cleanup();
    }
    expect(files.some((path) => existsSync(path))).toBe(false);
  });
});
