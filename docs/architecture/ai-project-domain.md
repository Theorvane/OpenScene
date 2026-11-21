# Legacy project metadata

The ai field in saved projects remains readable for projects created by earlier versions. Its codec lives in src/shared/aiProjectDomain.ts and is shared by desktop and mobile persistence.

Legacy scripts, scene records, generation provenance, narration plans and media references are data carried by the stored document. Current project editing uses the assets list and timeline. Retaining these fields prevents opening and saving an existing project from dropping its metadata or orphaning its imported files.

The validator checks field types and asset references. It performs no provider calls, media synthesis, browser automation or model downloads. Tests in tests/aiProjectDomain.test.ts and the project codec suites cover stored-document compatibility.
