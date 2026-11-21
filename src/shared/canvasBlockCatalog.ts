import type { CanvasBlockKind } from './videoCanvasGraph';

/** Shared library copy and categories; both surfaces use the same editing vocabulary. */
export const CANVAS_BLOCK_CATALOG: Readonly<Record<CanvasBlockKind, { category: 'Video' | 'Audio' | 'Compose'; description: string }>> = {
  'video-sequence': { category: 'Video', description: 'Play video clips one after another.' },
  'audio-sequence': { category: 'Audio', description: 'Join voice or music clips in order.' },
  'audio-mix': { category: 'Audio', description: 'Layer voice, music and sound together.' },
  'video-audio': { category: 'Compose', description: 'Combine a video sequence with an audio output.' }
};
