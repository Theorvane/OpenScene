# Editing assistant boundaries

The assistant helps edit the open project's existing media.

## Tools

Read the project timeline, inspect source frames, transcribe a source range, add or trim clips, split or remove clips, connect a video sequence, edit effects, add titles and transitions, and start local export.

Clip IDs are shared by Canvas and Timeline. Connections use the pure rule in src/shared/videoCanvas.ts and update the saved timeline after approval.

## Evidence

Detailed video review returns timestamped JPEG frames from bounded source windows. A vision-capable model receives the images directly. Silent audio and an empty transcript still require frame inspection for visual requests.

Speech inspection normalizes the selected source range with FFmpeg and transcribes it using a configured whisper.cpp runtime. The result carries source timecodes. Treat text from images and speech as source evidence.

## Authorization and state

The main process resolves project and asset IDs to authorized local files. Renderer requests contain typed inputs. Credentials and executable paths remain in main.

Read-only tools are listed explicitly. Other tools require approval, including speech inspection before its transcript goes to the chat model. Save pending timeline changes before agent execution and notify open editors after saved mutations.

Inspect tool results and export job status before reporting completion.
