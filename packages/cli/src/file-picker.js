import { spawn } from 'node:child_process';

const videoFilter = '*.mp4;*.m4v;*.mov;*.mkv;*.webm;*.avi;*.mpeg;*.mpg;*.ts;*.wmv;*.3gp;*.mxf';

export async function pickVideoFile() {
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$picker = New-Object System.Windows.Forms.OpenFileDialog',
      "$picker.Title = 'Choose a video to upload to Vexor'",
      `$picker.Filter = 'Video files|${videoFilter}|All files|*.*'`,
      '$picker.Multiselect = $false',
      'if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($picker.FileName))) }',
    ].join('; ');
    const result = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
    if (result.code === 1) return null;
    if (result.code !== 0) throw new Error('Windows file picker could not open.');
    const encodedPath = result.stdout.trim();
    return encodedPath ? Buffer.from(encodedPath, 'base64').toString('utf8') : null;
  }

  if (process.platform === 'darwin') {
    const result = await run('osascript', ['-e', 'POSIX path of (choose file with prompt "Choose a video to upload to Vexor" of type {"public.movie"})']);
    if (result.code === 1) return null;
    if (result.code !== 0) throw new Error('macOS file picker could not open.');
    return result.stdout.trim() || null;
  }

  try {
    const result = await run('zenity', ['--file-selection', '--title=Choose a video to upload to Vexor', `--file-filter=Video files | ${videoFilter.replaceAll(';', ' ')}`, '--file-filter=All files | *']);
    if (result.code === 1) return null;
    if (result.code !== 0) throw new Error('Linux file picker failed.');
    return result.stdout.trim() || null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const result = await run('kdialog', ['--getopenfilename', '.', `Video files (${videoFilter.replaceAll(';', ' ')})`]);
  if (result.code === 1) return null;
  if (result.code !== 0) throw new Error('Linux file picker could not open.');
  return result.stdout.trim() || null;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout }));
  });
}
