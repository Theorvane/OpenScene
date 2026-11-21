# OpenScene mobile

The mobile app edits local projects with Edit, Canvas, Library and an editing assistant.

Canvas shows video clip cards in playback order and uses src/shared/videoCanvas.ts to connect clips. Applying a connection updates the saved timeline. The same project store supplies Edit and Library.

Desktop frame and speech inspection are unavailable in mobile chat. Imported media and legacy project metadata remain readable.

Install dependencies with npm ci and check the app with npm run typecheck. See README-native.md for native development and RELEASING.md for release procedures.
