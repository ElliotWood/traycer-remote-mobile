# scratch helper (not committed): run a local shell script on the Azure VM via az run-command
# usage: pwsh vmrun.ps1 <path-to-script.sh>
param([Parameter(Mandatory=$true)][string]$ScriptPath)
$az = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
$bytes = [System.IO.File]::ReadAllBytes($ScriptPath)
$b64 = [Convert]::ToBase64String($bytes)
$wrapper = "echo $b64 | base64 -d > /tmp/_vmrun.sh; bash /tmp/_vmrun.sh 2>&1"
& $az vm run-command invoke -g altra-rg-traycer-aue -n altra-vm-traycer-host-aue `
  --command-id RunShellScript --scripts $wrapper --query "value[0].message" -o tsv
