; Lists EasyView_Md under Explorer's "Open with" for Markdown files without taking over the
; default handler. SHCTX is HKCU for "only for me" installs and HKLM for "all users" installs.
; Keep in sync with src/main/adapters/electron/fileAssociations.ts.

!macro easyviewWriteMarkdownExtension EXT
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "EasyViewMd.Markdown" ""
  WriteRegStr SHCTX "Software\Classes\Applications\EasyView_Md.exe\SupportedTypes" "${EXT}" ""
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
