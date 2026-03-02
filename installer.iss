; eID Service — Inno Setup Installer Script
; Builds a Windows .exe installer for per-user installation (no admin required).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{B8E2F4A1-9C3D-4E5F-A6B7-8C9D0E1F2A3B}
AppName=eID Service
AppVersion={#AppVersion}
AppPublisher=Johan Coppens
AppPublisherURL=https://github.com/johancoppens/eid-service
DefaultDirName={localappdata}\eid-service
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=.
OutputBaseFilename=eid-service-windows-x64-setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ChangesEnvironment=yes

[Files]
Source: "dist\bun.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\host.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\addon.node"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\eid-service.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "EidService"; ValueType: string; ValueData: """{app}\bun.exe"" ""{app}\host.js"" start"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\bun.exe"; Parameters: """{app}\host.js"" start"; Flags: nowait postinstall runhidden; Description: "Start eID Service"

[UninstallRun]
Filename: "taskkill.exe"; Parameters: "/IM bun.exe /F"; Flags: runhidden; RunOnceId: "StopService"

[Code]

procedure StopExistingService;
var
  ResultCode: Integer;
begin
  Exec('taskkill.exe', '/IM bun.exe /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(500);
end;

procedure CreateDefaultConfig;
var
  ConfigDir: String;
  ConfigPath: String;
  Content: String;
begin
  ConfigDir := ExpandConstant('{%USERPROFILE}') + '\.config\eid-service';
  ConfigPath := ConfigDir + '\config.json';

  if not DirExists(ConfigDir) then
    ForceDirectories(ConfigDir);

  if not FileExists(ConfigPath) then
  begin
    Content := '{' + #13#10 +
      '  "port": 17365,' + #13#10 +
      '  "allowedOrigins": []' + #13#10 +
      '}' + #13#10;
    SaveStringToFile(ConfigPath, Content, False);
  end;
end;

procedure AddToUserPath;
var
  OldPath: String;
  AppDir: String;
begin
  AppDir := ExpandConstant('{app}');
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', OldPath) then
    OldPath := '';

  if Pos(Uppercase(AppDir), Uppercase(OldPath)) = 0 then
  begin
    if OldPath <> '' then
      RegWriteExpandStringValue(HKCU, 'Environment', 'Path', AppDir + ';' + OldPath)
    else
      RegWriteExpandStringValue(HKCU, 'Environment', 'Path', AppDir);
  end;
end;

procedure RemoveFromUserPath;
var
  OldPath: String;
  AppDir: String;
  NewPath: String;
begin
  AppDir := ExpandConstant('{app}');
  if RegQueryStringValue(HKCU, 'Environment', 'Path', OldPath) then
  begin
    NewPath := OldPath;
    StringChangeEx(NewPath, AppDir + ';', '', True);
    StringChangeEx(NewPath, ';' + AppDir, '', True);
    StringChangeEx(NewPath, AppDir, '', True);
    if NewPath <> OldPath then
      RegWriteExpandStringValue(HKCU, 'Environment', 'Path', NewPath);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    StopExistingService;

  if CurStep = ssPostInstall then
  begin
    CreateDefaultConfig;
    AddToUserPath;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ConfigDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    RemoveFromUserPath;

    ConfigDir := ExpandConstant('{%USERPROFILE}') + '\.config\eid-service';
    if DirExists(ConfigDir) then
    begin
      if MsgBox('Remove configuration files?', mbConfirmation, MB_YESNO) = IDYES then
        DelTree(ConfigDir, True, True, True);
    end;
  end;
end;
