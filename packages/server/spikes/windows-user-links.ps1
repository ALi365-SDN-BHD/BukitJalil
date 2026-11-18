# Creates a throwaway ordinary local user on the CI runner, runs windows-user-links.mjs as that user and prints
# the result. The account and its random password exist only on this one-run virtual machine.
$ErrorActionPreference = "Stop"
$name = "probeuser"
$plain = "Pr0be-" + [guid]::NewGuid().ToString("N")
$pw = ConvertTo-SecureString $plain -AsPlainText -Force
New-LocalUser -Name $name -Password $pw -AccountNeverExpires -PasswordNeverExpires | Out-Null
Add-LocalGroupMember -Group "Users" -Member $name

$work = "C:\probe-work"
New-Item -ItemType Directory -Force -Path $work | Out-Null
icacls $work /grant "${name}:(OI)(CI)M" | Out-Null

$node = (Get-Command node).Source
$git = (Get-Command git).Source
$script = Join-Path $PSScriptRoot "windows-user-links.mjs"
$copy = Join-Path $work "windows-user-links.mjs"
Copy-Item $script $copy

$cred = New-Object System.Management.Automation.PSCredential(".\$name", $pw)
$p = Start-Process -FilePath $node -ArgumentList "`"$copy`" `"$work`" `"$git`"" -Credential $cred -LoadUserProfile -WorkingDirectory $work -PassThru -Wait
"exit code: $($p.ExitCode)"
$result = Join-Path $work "result.json"
if (Test-Path $result) { Get-Content $result -Raw; Copy-Item $result (Join-Path $env:GITHUB_WORKSPACE "windows-user-links.json") } else { "no result.json written" }
