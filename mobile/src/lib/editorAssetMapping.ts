import type { MobileProject } from './projectStore';
import { assetUri } from './projectStore';
import type { EditorAsset } from './editorState';

export function projectEditorAssets(project: MobileProject): readonly EditorAsset[] {
  return project.assets.map(asset => ({ id: asset.id, uri: assetUri(project.id, asset), displayName: asset.displayName,
    kind: asset.kind, mimeType: asset.mimeType, byteLength: 0, projectRelativePath: asset.relativePath,
    createdAt: project.createdAt, updatedAt: project.updatedAt,
    metadata: { durationMs: asset.durationMs, width: asset.width, height: asset.height } }));
}
