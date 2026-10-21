!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
!macro customFinishPage
Function ZivarExtensionGuide
  !insertmacro MUI_HEADER_TEXT "Panduan ekstensi Chrome" "Langkah opsional agar tautan dan video dapat dikirim dari Chrome."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Aplikasi sudah terpasang. Ekstensi Chrome dipasang secara manual. Anda tetap dapat mengunduh dari URL tanpa ekstensi."
  Pop $0
  ${NSD_CreateLabel} 0 31u 100% 20u "1. Buka ZIVAR setelah setup. Panduan dengan tombol bantuan akan tampil."
  Pop $0
  ${NSD_CreateLabel} 0 57u 100% 20u "2. Di Chrome, buka chrome://extensions dan aktifkan Developer mode."
  Pop $0
  ${NSD_CreateLabel} 0 83u 100% 27u "3. Klik Load unpacked. Pilih folder yang ditunjukkan tombol Buka folder ekstensi di ZIVAR."
  Pop $0
  ${NSD_CreateLabel} 0 116u 100% 27u "4. Buka ikon ZIVAR di Chrome. Salin kode pairing dari aplikasi, tempel di ekstensi, lalu klik Hubungkan."
  Pop $0
  ${NSD_CreateLabel} 0 152u 100% 25u "Untuk video: mulai pemutaran, lalu klik Unduh video di kanan atas pemutar. Mendukung MP4/WebM langsung, HLS/DASH, dan YouTube (pilih kualitas). Video DRM tidak didukung."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function ZivarStartAfterSetup
  ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--show-setup"
FunctionEnd

  Page custom ZivarExtensionGuide
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Buka ZIVAR dan panduan ekstensi"
  !define MUI_FINISHPAGE_RUN_FUNCTION ZivarStartAfterSetup
  !insertmacro MUI_PAGE_FINISH
!macroend
!endif
