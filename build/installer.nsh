!macro customInstall
  ${IfNot} ${isUpdated}
    Push $0
    ClearErrors
    SearchPath $0 "ffmpeg.exe"
    ${If} ${Errors}
    ${AndIfNot} ${FileExists} "$LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe"
      DetailPrint "Installing FFmpeg with WinGet..."
      ClearErrors
      ExecWait '"$LOCALAPPDATA\Microsoft\WindowsApps\winget.exe" install --id Gyan.FFmpeg --exact --source winget --scope user --no-upgrade --disable-interactivity --accept-source-agreements --accept-package-agreements' $0
      ${If} ${Errors}
      ${OrIf} $0 != 0
        DetailPrint "FFmpeg installation failed."
        MessageBox MB_OK|MB_ICONEXCLAMATION "OpenScene was installed, but FFmpeg could not be installed automatically. Install FFmpeg separately to enable MP4 export." /SD IDOK
      ${EndIf}
    ${EndIf}
    ClearErrors
    Pop $0
  ${EndIf}
!macroend
