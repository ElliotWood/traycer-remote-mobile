// A0's DNS piece: an A record in an EXISTING zone pointing `publicHostname`
// at the VM's public IP. Everything else A0 requires (TLS termination,
// the 64 MB body cap, rate limiting) is nginx/certbot configuration that
// runs ON the VM at first boot (see vm.bicep's customData, which embeds
// bootstrap.sh) - not a distinct Azure resource, so it has no module of
// its own. This module's only job is the one thing that IS a distinct,
// provisionable Azure resource: the DNS record.
//
// DNS zone CREATION/delegation is explicitly out of scope (see
// main.bicep's top-of-file comment) - `dnsZoneName` names a zone this
// subscription/resource group is assumed to already own. If it's empty,
// this module does nothing and the operator points DNS at
// `publicIpAddress` manually.

@description('Existing Azure DNS zone name (e.g. `example.com`) that `publicHostname` is a record within. Empty skips DNS record creation entirely - the operator points DNS at the output IP manually.')
param dnsZoneName string

@description('The public hostname A0 terminates TLS for (e.g. `traycer.example.com`). Must be `dnsZoneName` itself or a subdomain of it when `dnsZoneName` is non-empty - validated below, not just assumed.')
param publicHostname string

@description('VM public IP address to point the A record at.')
param vmPublicIpAddress string

// Record name is publicHostname with the zone suffix stripped - '@' (zone
// apex) if they're equal. `contains`/`endsWith` check, not a blind
// string-length subtraction, so a misconfigured `publicHostname` that
// isn't actually within `dnsZoneName` fails loudly at deploy time instead
// of silently creating a record under the wrong name.
var isApex = publicHostname == dnsZoneName
var hasCorrectSuffix = isApex || endsWith(publicHostname, '.${dnsZoneName}')
var recordName = isApex ? '@' : substring(publicHostname, 0, length(publicHostname) - length(dnsZoneName) - 1)

resource zone 'Microsoft.Network/dnsZones@2023-07-01-preview' existing = if (!empty(dnsZoneName)) {
  name: dnsZoneName
}

resource aRecord 'Microsoft.Network/dnsZones/A@2023-07-01-preview' = if (!empty(dnsZoneName) && hasCorrectSuffix) {
  parent: zone
  name: recordName
  properties: {
    TTL: 300
    ARecords: [
      {
        ipv4Address: vmPublicIpAddress
      }
    ]
  }
}

@description('True if a DNS record was created by this deployment.')
output dnsRecordCreated bool = !empty(dnsZoneName) && hasCorrectSuffix
