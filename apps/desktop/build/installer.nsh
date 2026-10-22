; Lists EasyView_Md under Explorer's "Open with" for Markdown files without taking over the
; default handler. SHCTX is HKCU for "only for me" installs and HKLM for "all users" installs.
; Keep in sync with src/main/adapters/electron/fileAssociations.ts.

!macro easyviewWriteMarkdownExtension EXT
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "EasyViewMd.Markdown" ""
  WriteRegStr SHCTX "Software\Classes\Applications\EasyView_Md.exe\SupportedTypes" "${EXT}" ""
!macroend

; Upgrades stay in the scope of the existing install: picking the other scope would leave the old copy
; behind. A per-machine install wins when both exist, because installing for all users also removes
; the per-user copy.
!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${if} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${elseif} $hasPerUserInstallation == "1"
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  !endif
!macroend

; Removes a Squirrel install (2.0.14 and earlier, %LOCALAPPDATA%\easyview_md). Runs after the old
; NSIS install is removed but before shortcuts are created, since Squirrel's uninstall deletes the
; same-named desktop shortcut; customInstall then rewrites the "Open with" keys it removes.
; Squirrel's Update.exe cannot delete itself and leaves the folder behind, so it is removed here.
!macro customFiles_x64
  Push $0
  Push $1
  Push $2
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\easyview_md" "QuietUninstallString"
  ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\easyview_md" "InstallLocation"
  ${if} $0 != ""
    DetailPrint "Removing the previous EasyView_Md (Squirrel) installation"
    ExecWait '$0' $1
    DetailPrint "Squirrel uninstall exit code: $1"
    StrCpy $1 $2 "" -12
    ${if} $1 == "\easyview_md"
      RMDir /r "$2"
    ${endif}
  ${endif}
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\EasyViewMd.Markdown" "" "Markdown"
  WriteRegStr SHCTX "Software\Classes\EasyViewMd.Markdown\DefaultIcon" "" '"$INSTDIR\EasyView_Md.exe",0'
  WriteRegStr SHCTX "Software\Classes\EasyViewMd.Markdown\shell\open\command" "" '"$INSTDIR\EasyView_Md.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\Applications\EasyView_Md.exe" "FriendlyAppName" "EasyView_Md"
  WriteRegStr SHCTX "Software\Classes\Applications\EasyView_Md.exe\shell\open\command" "" '"$INSTDIR\EasyView_Md.exe" "%1"'
  !insertmacro easyviewWriteMarkdownExtension ".md"
  !insertmacro easyviewWriteMarkdownExtension ".markdown"
  !insertmacro easyviewWriteMarkdownExtension ".mdx"
  ; SHCNE_ASSOCCHANGED so Explorer picks up the new "Open with" entry immediately.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\EasyViewMd.Markdown"
  DeleteRegKey SHCTX "Software\Classes\Applications\EasyView_Md.exe"
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "EasyViewMd.Markdown"
  DeleteRegValue SHCTX "Software\Classes\.markdown\OpenWithProgids" "EasyViewMd.Markdown"
  DeleteRegValue SHCTX "Software\Classes\.mdx\OpenWithProgids" "EasyViewMd.Markdown"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
