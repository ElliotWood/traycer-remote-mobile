// The multi-tenant host VM (A1) - one VM, one shared OS user, N systemd
// instances of `traycer-host@.service`. All first-boot provisioning is
// assembled here from three independently reviewable source files
// (`traycer-host-guard.sh`, the unit template, `bootstrap.sh`) via
// `loadTextContent`, rather than one giant inline script - see each
// source file's own module doc for what it does.

@description('Azure region.')
param location string

@description('Workload identifier for naming.')
param workload string

@description('Region abbreviation for naming.')
param regionAbbrev string

@description('VM size.')
param vmSize string

@description('VM administrator username (SSH key auth only).')
param adminUsername string

@description('SSH public key for the admin account.')
@secure()
param adminSshPublicKey string

@description('Subnet resource id from the network module.')
param subnetId string

@description('NSG resource id from the network module - attached to the NIC as defence-in-depth alongside the subnet-level association network.bicep already made.')
param nsgId string

@description('Tenant ids to provision systemd instances and HOME directories for. See this module\'s customData assembly for the scope boundary on what "provisioned" means here (scaffolding only - see bootstrap.sh).')
param tenantIds array

@description('Public hostname the ingress terminates TLS for - passed through to bootstrap.sh for the nginx/certbot phase.')
param publicHostname string

@description('ACME contact email for certbot.')
param acmeContactEmail string

var namePrefix = 'altra'
var vmName = '${namePrefix}-vm-${workload}-${regionAbbrev}'
var nicName = '${namePrefix}-nic-${workload}-${regionAbbrev}'
var pipName = '${namePrefix}-pip-${workload}-${regionAbbrev}'
var dnsLabel = '${namePrefix}-${workload}-${regionAbbrev}'

var osUser = 'traycer'
var homeRoot = '/srv/traycer/tenants'
var tenantIdsSpaceSeparated = join(tenantIds, ' ')

var guardScript = loadTextContent('../../scripts/traycer-host-guard.sh')
var unitTemplate = loadTextContent('../../systemd/traycer-host@.service')
var bootstrapScript = loadTextContent('../../scripts/bootstrap.sh')

// A6 - alerting/probe scripts and the units that call them. See each
// file's own module doc; embedded the same way as the three above
// (loadTextContent + heredoc in customData), not a separate mechanism.
var alertScript = loadTextContent('../../scripts/traycer-alert.sh')
var hostFailureAlertScript = loadTextContent('../../scripts/traycer-host-failure-alert.sh')
var worktreeRescueScript = loadTextContent('../../scripts/traycer-worktree-rescue.sh')
var healthProbeScript = loadTextContent('../../scripts/traycer-health-probe.sh')
var hostAlertUnitTemplate = loadTextContent('../../systemd/traycer-host-alert@.service')
var healthProbeUnitTemplate = loadTextContent('../../systemd/traycer-health-probe@.service')
var healthProbeTimerTemplate = loadTextContent('../../systemd/traycer-health-probe@.timer')

// Tenant id format (lowercase, digits, hyphen - a safe systemd instance
// name / POSIX directory-name fragment) is validated at VM-boot time in
// bootstrap.sh, NOT here. Bicep's expression language has no regex
// function to enforce it at deploy time without adding a
// Microsoft.Resources/deploymentScripts resource - a real, billed Azure
// resource (a container instance) just to run a string check, which is
// disproportionate for this and would also cut against "commit but do not
// provision" if it were ever deployed for real. bootstrap.sh's validation
// runs before any directory is created from a tenant id, refusing loudly
// (see its own comment) rather than letting a malformed id reach
// `mkdir -p "${TRAYCER_HOME_ROOT}/${tenant_id}"` unquoted - the same
// path-traversal concern, enforced at the point that actually matters,
// documented here as a deliberate choice rather than an oversight.

// A `'''...'''` multi-line literal would read far better here, but Bicep's
// multi-line strings do NOT support `${}` interpolation (confirmed via
// `az bicep build` - the first draft of this variable compiled clean but
// emitted the literal text "${guardScript}" into customData instead of
// the actual script, which would have broken every deployment silently
// until someone read cloud-init's log on a live VM). Regular interpolated
// strings only allow `\n` for newlines, not literal ones - hence the
// unusual single-line-with-escapes shape below; it is correctness-tested
// via `az bicep build`'s compiled output, not just visually reviewed.
var customDataScript = '#!/bin/bash\nset -euo pipefail\nexport TRAYCER_OS_USER="${osUser}"\nexport TRAYCER_HOME_ROOT="${homeRoot}"\nexport TRAYCER_TENANT_IDS="${tenantIdsSpaceSeparated}"\nexport TRAYCER_PUBLIC_HOSTNAME="${publicHostname}"\nexport TRAYCER_ACME_EMAIL="${acmeContactEmail}"\n\nmkdir -p /usr/local/bin\ncat > /usr/local/bin/traycer-host-guard.sh <<\'TRAYCER_GUARD_EOF\'\n${guardScript}\nTRAYCER_GUARD_EOF\ncat > /usr/local/bin/traycer-alert.sh <<\'TRAYCER_ALERT_EOF\'\n${alertScript}\nTRAYCER_ALERT_EOF\ncat > /usr/local/bin/traycer-host-failure-alert.sh <<\'TRAYCER_HOSTFAIL_EOF\'\n${hostFailureAlertScript}\nTRAYCER_HOSTFAIL_EOF\ncat > /usr/local/bin/traycer-worktree-rescue.sh <<\'TRAYCER_RESCUE_EOF\'\n${worktreeRescueScript}\nTRAYCER_RESCUE_EOF\ncat > /usr/local/bin/traycer-health-probe.sh <<\'TRAYCER_PROBE_EOF\'\n${healthProbeScript}\nTRAYCER_PROBE_EOF\nchmod +x /usr/local/bin/traycer-host-guard.sh /usr/local/bin/traycer-alert.sh /usr/local/bin/traycer-host-failure-alert.sh /usr/local/bin/traycer-worktree-rescue.sh /usr/local/bin/traycer-health-probe.sh\n\nmkdir -p /etc/systemd/system\ncat > /etc/systemd/system/traycer-host@.service <<\'TRAYCER_UNIT_EOF\'\n${unitTemplate}\nTRAYCER_UNIT_EOF\ncat > /etc/systemd/system/traycer-host-alert@.service <<\'TRAYCER_HOSTALERT_UNIT_EOF\'\n${hostAlertUnitTemplate}\nTRAYCER_HOSTALERT_UNIT_EOF\ncat > /etc/systemd/system/traycer-health-probe@.service <<\'TRAYCER_PROBE_UNIT_EOF\'\n${healthProbeUnitTemplate}\nTRAYCER_PROBE_UNIT_EOF\ncat > /etc/systemd/system/traycer-health-probe@.timer <<\'TRAYCER_PROBE_TIMER_EOF\'\n${healthProbeTimerTemplate}\nTRAYCER_PROBE_TIMER_EOF\nsed -i "s|__TRAYCER_OS_USER__|${osUser}|g; s|__TRAYCER_HOME_ROOT__|${homeRoot}|g" /etc/systemd/system/traycer-host@.service /etc/systemd/system/traycer-host-alert@.service /etc/systemd/system/traycer-health-probe@.service\n\n${bootstrapScript}\n'

resource pip 'Microsoft.Network/publicIPAddresses@2023-11-01' = {
  name: pipName
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: {
      domainNameLabel: dnsLabel
    }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2023-11-01' = {
  name: nicName
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: {
            id: subnetId
          }
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: {
            id: pip.id
          }
        }
      }
    ]
    networkSecurityGroup: {
      id: nsgId
    }
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: vmName
  location: location
  // System-assigned identity: required for the Azure Monitor Agent
  // (monitoring.bicep) to authenticate its uploads at all - found live,
  // not assumed. AMA requests a token from IMDS using this identity;
  // without it, IMDS returns "Identity not found" and AMA retries
  // forever, silently shipping nothing (Heartbeat/Syslog both stayed
  // empty in Log Analytics with no error surfaced anywhere except AMA's
  // own on-box log) - a monitoring pipeline that looks deployed but ships
  // no data is exactly the "up, responding, reporting nothing" shape A6
  // exists to catch, this time in A6's own infrastructure.
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    hardwareProfile: {
      vmSize: vmSize
    }
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      customData: base64(customDataScript)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: adminSshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'StandardSSD_LRS'
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
        }
      ]
    }
  }
}

@description('Public IP resource id.')
output publicIpId string = pip.id

@description('Public IP address.')
output publicIpAddress string = pip.properties.ipAddress

@description('Azure-assigned public FQDN for the IP (informational fallback; the real hostname is `publicHostname`, pointed here out-of-band).')
output publicFqdn string = pip.properties.dnsSettings.fqdn

@description('VM resource id.')
output vmResourceId string = vm.id

@description('System-assigned managed identity principal id - consumed by monitoring.bicep for the AMA role assignment.')
output vmPrincipalId string = vm.identity.principalId
