import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

// Fixed program: task text is only read from stdin (UTF-8), never part of PowerShell syntax.
const popup = String.raw`
$ErrorActionPreference = 'Stop'
$inputReader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(),[System.Text.UTF8Encoding]::new($false))
try { $message = $inputReader.ReadToEnd() } finally { $inputReader.Dispose() }
if (-not [Environment]::UserInteractive) { exit 2 }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = [System.Windows.Forms.Form]::new()
$timer = [System.Windows.Forms.Timer]::new()
try {
  $form.Text = -join (0x5f85,0x529e,0x8282,0x62cd,0x20,0xb7,0x20,0x63d0,0x9192 | ForEach-Object { [char]$_ })
  $form.BackColor = [System.Drawing.Color]::FromArgb(248,250,253)
  $form.TopMost = $true
  $form.ShowInTaskbar = $false
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.ClientSize = [System.Drawing.Size]::new(360,145)
  $form.Location = [System.Drawing.Point]::new($area.Right - $form.Width - 16,$area.Bottom - $form.Height - 16)
  $label = [System.Windows.Forms.TextBox]::new()
  $label.SetBounds(16,14,328,78)
  $label.Multiline = $true
  $label.ReadOnly = $true
  $label.BackColor = [System.Drawing.Color]::White
  $label.Font = [System.Drawing.Font]::new($label.Font.FontFamily,11)
  $label.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
  $label.Text = $message
  $form.Controls.Add($label)
  $button = [System.Windows.Forms.Button]::new()
  $button.Text = -join (0x77e5,0x9053,0x4e86 | ForEach-Object { [char]$_ })
  $button.SetBounds(258,104,86,28)
  $button.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.AcceptButton = $button
  $form.CancelButton = $button
  $form.Controls.Add($button)
  $timer.Interval = 15000
  $timer.Add_Tick({ $form.Close() })
  $timer.Start()
  [void]$form.ShowDialog()
} finally {
  $timer.Dispose()
  $form.Dispose()
}
`;

export function createWindowsNotifier({
  platform=process.platform,env=process.env,hasFile=existsSync,spawnProcess=spawn,
  report=reason=>console.warn('Windows popup failed:',reason),
}={}){
  const root=env.SystemRoot || env.WINDIR;
  const executable=root && win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
  if(platform!=='win32' || env.TODO_WINDOWS_NOTIFY==='0' || /^services$/i.test(env.SESSIONNAME||'') || !executable || !hasFile(executable)) return null;
  const maxWaiting=5,waiting=[];
  let current=null,stopped=false;
  function pump(){
    if(stopped||current||!waiting.length) return;
    const item=waiting.shift();
    let child;
    try{
      child=spawnProcess(executable,['-NoLogo','-NoProfile','-NonInteractive','-STA','-Command',popup],
        {windowsHide:true,stdio:['pipe','ignore','ignore']});
    }catch(err){report(err.code||err.message);queueMicrotask(pump);return;}
    current=child;
    const timeout=setTimeout(()=>child.kill(),22_000);
    timeout.unref();
    child.stdin.on('error',()=>{});
    child.once('error',err=>{if(!stopped) report(err.code||err.message);});
    child.once('close',(code,signal)=>{
      clearTimeout(timeout);
      current=null;
      if(!stopped && (code!==0 || signal)) report(signal || ('exit '+code));
      pump();
    });
    child.stdin.end(item,'utf8');
  }
  return {
    notify(events){
      if(stopped) return;
      const titles=events.slice(0,5).map(e=>String(e.title).replace(/[\r\n\u0000-\u001f\u007f]+/g,' ').slice(0,160));
      if(!titles.length) return;
      const count=events.length;
      const payload=titles.join('\r\n') + (count>titles.length ? '\r\n… +' + (count-titles.length) : '');
      if(waiting.length===maxWaiting) waiting.shift();
      waiting.push(payload);pump();
    },
    close(){stopped=true;waiting.length=0;current?.kill();}
  };
}
