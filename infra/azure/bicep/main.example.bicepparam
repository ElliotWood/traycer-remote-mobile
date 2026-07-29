// Example shape only — every value below is a placeholder. Copy this file
// to `main.bicepparam` (gitignored — see infra/azure/README.md) and fill
// in real values before running `az deployment group create`/`what-if`.
// Never commit the real file: `adminSshPublicKey` isn't secret by itself,
// but a filled-in file is deployment-specific state, not source.
using 'main.bicep'

param workload = 'traycer-host'
param regionAbbrev = 'aue'
param adminUsername = 'traycerops'
param adminSshPublicKey = 'ssh-ed25519 AAAA...replace-with-a-real-public-key... operator@example.com'
param vmSize = 'Standard_D4s_v3' // matches main.bicep's default - see its param doc for why, not Standard_D4as_v5
param publicHostname = 'traycer.example.com'
param acmeContactEmail = 'ops@example.com'
param sshAllowedCidrs = []
param tenantIds = []
param dnsZoneName = ''
param enableMonitoring = true
param alertEmailAddress = 'ops@example.com'
param monitoringDailyQuotaGb = 1
