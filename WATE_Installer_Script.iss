[Setup]
AppName=WATE Programming Language
AppVersion=1.0.0
DefaultDirName={autopf}\WATE
DefaultGroupName=WATE
OutputDir=.\
OutputBaseFilename=WATE_Setup_v1.0.0
Compression=lzma
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
SetupIconFile=wate.ico
WizardSmallImageFile=wate_small.bmp
WizardImageFile=wate_large.bmp
ChangesAssociations=yes
ChangesEnvironment=yes

[Files]
Source: "wate.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "wpm.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "wate.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "wate-vscode\wate-lang-2.1.0.vsix"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
; 1. Register .wate extension
Root: HKCR; Subkey: ".wate"; ValueType: string; ValueName: ""; ValueData: "Wate.Script"; Flags: uninsdeletevalue
Root: HKCR; Subkey: "Wate.Script"; ValueType: string; ValueName: ""; ValueData: "WATE Source File"; Flags: uninsdeletekey
Root: HKCR; Subkey: "Wate.Script\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\wate.ico,0"
Root: HKCR; Subkey: "Wate.Script\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\wate.exe"" ""%1"""

[Run]
; 2. Auto-install VS Code, Cursor, Windsurf, and Antigravity extensions (silently)
Filename: "cmd.exe"; Parameters: "/c code --install-extension ""{app}\wate-lang-2.1.0.vsix"" --force"; Flags: runhidden; StatusMsg: "Configuring VS Code..."
Filename: "cmd.exe"; Parameters: "/c cursor --install-extension ""{app}\wate-lang-2.1.0.vsix"" --force"; Flags: runhidden; StatusMsg: "Configuring Cursor IDE..."
Filename: "cmd.exe"; Parameters: "/c windsurf --install-extension ""{app}\wate-lang-2.1.0.vsix"" --force"; Flags: runhidden; StatusMsg: "Configuring Windsurf IDE..."
Filename: "cmd.exe"; Parameters: "/c antigravity --install-extension ""{app}\wate-lang-2.1.0.vsix"" --force"; Flags: runhidden; StatusMsg: "Configuring Antigravity IDE..."

[Code]
// 3. Add to System PATH
function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_LOCAL_MACHINE, 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', OrigPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Param + ';', ';' + OrigPath + ';') = 0;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  OrigPath: string;
begin
  if CurStep = ssPostInstall then
  begin
    if NeedsAddPath(ExpandConstant('{app}')) then
    begin
      RegQueryStringValue(HKEY_LOCAL_MACHINE, 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', OrigPath);
      RegWriteStringValue(HKEY_LOCAL_MACHINE, 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', OrigPath + ';' + ExpandConstant('{app}'));
    end;
  end;
end;
