// packages/@monomind/cli/src/orgrt/authority-mask-win32-launcher.ts
/**
 * The Windows PowerShell 5.1 launcher behind the native-Windows authority mask
 * (#852; authority-mask-win32.ts explains the design). Arguments: a base64 JSON
 * spec, then the program and its arguments. It
 *   1. applies the spec's ACL entries (explicit allow / deny entries for marker
 *      SIDs; they only ever match a restricted token that carries the marker),
 *   2. starts the program under a restricted copy of its own token (no
 *      privileges, the marker SIDs added as restricting SIDs) inside a
 *      kill-on-close job object, with the caller's stdin, stdout and stderr,
 *   3. exits with the program's exit code.
 * The P/Invoke layer is compiled by Add-Type at run time: no native addon, no
 * binary in the package. It is PowerShell 5.1 and .NET Framework only.
 */
export const WIN_LAUNCHER = String.raw`$ErrorActionPreference = 'Stop'
$spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0])) | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MMWin {
  [StructLayout(LayoutKind.Sequential)] public struct SAA { public IntPtr Sid; public uint Attr; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SI {
    public int cb; public string r1; public string desk; public string title;
    public int x, y, xs, ys, xc, yc, fill, flags; public short show, cbr2;
    public IntPtr r2, hin, hout, herr; }
  [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr hp, ht; public int pid, tid; }
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint a, out IntPtr t);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool CreateRestrictedToken(IntPtr t, uint f, uint nd, IntPtr d, uint nde, IntPtr de, uint nr, SAA[] r, out IntPtr n);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSidW(string s, out IntPtr sid);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUserW(IntPtr t, string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inh, uint fl, IntPtr env, string cwd, ref SI si, out PI pi);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint m, uint f);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr i, int l);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint c);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h, uint c);
  public static int Run(string[] sids, string cmdline, string cwd) {
    IntPtr tok;
    if (!OpenProcessToken(GetCurrentProcess(), 0xB, out tok)) throw new Exception("OpenProcessToken " + Marshal.GetLastWin32Error());
    SAA[] res = new SAA[sids.Length];
    for (int i = 0; i < sids.Length; i++) {
      if (!ConvertStringSidToSidW(sids[i], out res[i].Sid)) throw new Exception("bad sid " + sids[i]);
    }
    IntPtr rt;
    if (!CreateRestrictedToken(tok, 1, 0, IntPtr.Zero, 0, IntPtr.Zero, (uint)res.Length, res, out rt)) throw new Exception("CreateRestrictedToken " + Marshal.GetLastWin32Error());
    IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
    int sz = IntPtr.Size == 8 ? 144 : 112;
    IntPtr info = Marshal.AllocHGlobal(sz);
    for (int i = 0; i < sz; i++) Marshal.WriteByte(info, i, 0);
    Marshal.WriteInt32(info, 16, 0x2000);
    if (!SetInformationJobObject(job, 9, info, sz)) throw new Exception("SetInformationJobObject " + Marshal.GetLastWin32Error());
    SI si = new SI(); si.cb = Marshal.SizeOf(typeof(SI)); si.flags = 0x100;
    si.hin = GetStdHandle(-10); si.hout = GetStdHandle(-11); si.herr = GetStdHandle(-12);
    foreach (IntPtr h in new IntPtr[] { si.hin, si.hout, si.herr }) SetHandleInformation(h, 1, 1);
    PI pi;
    if (!CreateProcessAsUserW(rt, null, new StringBuilder(cmdline), IntPtr.Zero, IntPtr.Zero, true, 4, IntPtr.Zero, cwd, ref si, out pi)) throw new Exception("CreateProcessAsUser " + Marshal.GetLastWin32Error());
    if (!AssignProcessToJobObject(job, pi.hp)) { TerminateProcess(pi.hp, 1); throw new Exception("AssignProcessToJobObject " + Marshal.GetLastWin32Error()); }
    ResumeThread(pi.ht);
    WaitForSingleObject(pi.hp, 0xFFFFFFFF);
    uint code; GetExitCodeProcess(pi.hp, out code);
    return (int)code;
  }
}
'@
foreach ($d in $spec.deny) {
  if (-not (Test-Path -LiteralPath $d.path)) { continue }
  $item = Get-Item -LiteralPath $d.path -Force
  $inh = if ($item.PSIsContainer) { 'ContainerInherit, ObjectInherit' } else { 'None' }
  $type = if ($d.allow) { 'Allow' } else { 'Deny' }
  $rule = New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($d.sid)), $d.rights, $inh, 'None', $type)
  try { $acl = $item.GetAccessControl('Access'); $acl.AddAccessRule($rule); $item.SetAccessControl($acl) }
  catch { [Console]::Error.WriteLine('mm-win-mask: cannot set ACL on ' + $d.path + ': ' + $_.Exception.Message); exit 125 }
}
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$sids = @($id.User.Value, 'S-1-1-0', 'S-1-5-32-545', 'S-1-5-11') + @($spec.markers)
foreach ($g in $id.Groups) { if ($g.Value -like 'S-1-5-5-*' -or $g.Value -eq 'S-1-5-32-544') { $sids += $g.Value } }
function Quote($a) {
  if ($a -ne '' -and $a -notmatch '[\s"]') { return $a }
  $s = $a -replace '(\\*)"', '$1$1\"'
  $s = $s -replace '(\\+)$', '$1$1'
  return '"' + $s + '"'
}
$exe = $args[1]
$found = Get-Command -Name $exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($found) { $exe = $found.Source }
$inner = (@($exe) + @($args | Select-Object -Skip 2) | ForEach-Object { Quote $_ }) -join ' '
$line = if ($exe -match '\.(cmd|bat)$') { (Quote $env:ComSpec) + ' /d /s /c "' + $inner + '"' } else { $inner }
exit ([MMWin]::Run($sids, $line, (Get-Location).Path))
`;
