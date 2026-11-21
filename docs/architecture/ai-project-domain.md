# Legacy project metadata

This is a compatibility document. The active project model is described in [shared editor architecture](editor-project.md): imported assets, timeline, optional canvas graph and shared editing operations. The `ai` field does not enable a generation workspace or expand agent tools.

The ai field in saved projects remains readable for projects created by earlier versions. Its codec lives in src/shared/aiProjectDomain.ts and is shared by desktop and mobile persistence.

Legacy scripts, scene records, generation provenance, narration plans and media references are data carried by the stored document. Current project editing uses the assets list and timeline. Retaining these fields prevents opening and saving an existing project from dropping its metadata or orphaning its imported files.

The validator checks field types and asset references. It performs no provider calls, media synthesis, browser automation or model downloads. Tests in tests/aiProjectDomain.test.ts and the project codec suites cover stored-document compatibility.

Preserve this data when saving from Timeline, Canvas or approved agent operations. Product descriptions should explain current editing workflows rather than present legacy scripts, scene records or synthesis plans as active features.
