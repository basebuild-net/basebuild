Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, uint cButtons, IntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$process = Get-Process -Name "basebuild-app" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $process) { Write-Error "Basebuild process not found"; exit 1 }

$hwnd = $process.MainWindowHandle
[Win]::ShowWindow($hwnd, 9)
[Win]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 500

$rect = New-Object Win+RECT
[Win]::GetWindowRect($hwnd, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

function TakeScreenshot($name) {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $outDir = "C:\Users\user\Documents\repos\basebuild-app\screenshots"
    $bitmap.Save("$outDir\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Output "Saved $name.png ($width x $height)"
}

function ClickAt($x, $y) {
    [Win]::SetCursorPos($rect.Left + $x, $rect.Top + $y)
    Start-Sleep -Milliseconds 100
    [Win]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)  # LEFTDOWN
    [Win]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)  # LEFTUP
    Start-Sleep -Milliseconds 300
}

function SendKeys($keys) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep -Milliseconds 300
}

# Screenshot 1: Current state (should be first-run modal or main window)
TakeScreenshot "01-initial"

# If first-run modal is showing, press Escape to skip it, then screenshot
Start-Sleep -Milliseconds 500
SendKeys "{ESC}"
Start-Sleep -Milliseconds 500
TakeScreenshot "02-after-escape"

# Try to open settings via menu: Alt+F for File menu, but actually
# the app uses a custom menu bar. Let's try clicking where the "Edit" menu
# typically is (top-left area) and then "Preferences..."
# The menu bar is at the very top. Click "Edit" (approx x=40, y=8)
ClickAt 40 8
Start-Sleep -Milliseconds 200
TakeScreenshot "03-menu-edit"

# Press Escape to close menu
SendKeys "{ESC}"
Start-Sleep -Milliseconds 200

# Try Ctrl+, or Alt+E for Edit menu then P for Preferences
# Actually let's try clicking the Edit menu and look for Preferences
ClickAt 40 8
Start-Sleep -Milliseconds 200
# Press P for Preferences
SendKeys "p"
Start-Sleep -Milliseconds 500
TakeScreenshot "04-settings"

# Click on Defaults tab (approx position in settings sidebar)
# Settings sidebar tabs are on the left side of the modal content
# Let's try clicking at different x positions for the tabs
# The settings modal has a sidebar with tabs. Let's try clicking "Defaults"
ClickAt 200 80
Start-Sleep -Milliseconds 200
TakeScreenshot "05-settings-defaults"

# Click "Permissions"
ClickAt 200 110
Start-Sleep -Milliseconds 200
TakeScreenshot "06-settings-permissions"

# Click "Privacy"
ClickAt 200 140
Start-Sleep -Milliseconds 200
TakeScreenshot "07-settings-privacy"

# Close settings
SendKeys "{ESC}"
Start-Sleep -Milliseconds 300

Write-Output "Done capturing all screenshots"
