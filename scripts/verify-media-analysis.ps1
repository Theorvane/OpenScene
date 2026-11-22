param([switch]$SkipBuild, [switch]$AnalyzeEditor)
$ErrorActionPreference = 'Stop'
$repositoryPath = Split-Path -Parent $PSScriptRoot
$resultsPath = Join-Path $repositoryPath '.local-runtimes/linux-verification'
New-Item -ItemType Directory -Path $resultsPath -Force | Out-Null
& git -c core.autocrlf=false -C $repositoryPath archive HEAD -o (Join-Path $repositoryPath '.local-runtimes/verification-source.tar')
if ($LASTEXITCODE -ne 0) { throw 'Could not snapshot the project.' }
& git -c core.autocrlf=false -C (Join-Path $repositoryPath 'external/opencut') archive HEAD -o (Join-Path $repositoryPath '.local-runtimes/verification-opencut.tar')
if ($LASTEXITCODE -ne 0) { throw 'Could not snapshot the OpenCut source.' }
if (-not $SkipBuild) {
  & docker build -t openscene-media-analysis:local (Join-Path $PSScriptRoot 'media-analysis')
  if ($LASTEXITCODE -ne 0) { throw 'Could not build the analysis environment.' }
}
& docker image inspect openscene-media-analysis:local --format '{{.Id}}' | Set-Content (Join-Path $resultsPath 'image-id.txt')
& docker run --rm --mount "type=bind,source=$repositoryPath,target=/input,readonly" --mount "type=bind,source=$resultsPath,target=/results" openscene-media-analysis:local bash /input/scripts/media-analysis/verify.sh
if ($LASTEXITCODE -ne 0) { throw "Verification failed. See $resultsPath" }
if ($AnalyzeEditor) {
  & docker run --rm --network none --mount "type=bind,source=$repositoryPath,target=/input,readonly" --mount "type=bind,source=$resultsPath,target=/results" openscene-media-analysis:local bash /input/scripts/media-analysis/analyze-editor.sh
  if ($LASTEXITCODE -ne 0) { throw "REA analysis failed. See $resultsPath" }
}
Write-Output "Verification passed. Results: $resultsPath"
