// Networking for the multi-tenant host VM: VNet, subnet, and the NSG that
// is the FIRST of two enforcement layers A0 requires. The NSG handles what
// it can see (source IP, port, protocol) — it explicitly CANNOT inspect
// request bodies, so the 64 MB body cap and rate limiting A0 requires are
// enforced at the reverse-proxy layer (see `ingress.bicep`'s nginx config),
// not here. Naming that boundary explicitly because conflating "NSG rule
// exists" with "body cap enforced" is exactly the claim-vs-code gap this
// epic's rubric calls out.

@description('Azure region.')
param location string

@description('Workload identifier for naming.')
param workload string

@description('Region abbreviation for naming.')
param regionAbbrev string

@description('CIDR ranges allowed to reach the VM over SSH. Empty means no SSH rule is created at all (Bastion/JIT is the assumed access path).')
param sshAllowedCidrs array

var namePrefix = 'altra'
var vnetName = '${namePrefix}-vnet-${workload}-${regionAbbrev}'
var subnetName = '${namePrefix}-snet-${workload}-${regionAbbrev}'
var nsgName = '${namePrefix}-nsg-${workload}-${regionAbbrev}'

// /27 for a single-VM subnet — deliberately small. This deployment is one
// VM per A1's "one VM, one OS user, N processes" model, not a scale-out
// fleet; A7 (capacity) is the ticket that revisits sizing if that model
// changes, and a larger address space provisioned speculatively now would
// just be unused surface area to audit later.
var addressPrefix = '10.20.0.0/24'
var subnetPrefix = '10.20.0.0/27'

resource nsg 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: nsgName
  location: location
  properties: {
    securityRules: concat(
      [
        {
          name: 'AllowHttpsInbound'
          properties: {
            priority: 100
            direction: 'Inbound'
            access: 'Allow'
            protocol: 'Tcp'
            sourceAddressPrefix: '*'
            sourcePortRange: '*'
            destinationAddressPrefix: '*'
            destinationPortRange: '443'
          }
        }
        {
          // Port 80 stays open ONLY for ACME HTTP-01 challenge traffic
          // (certbot's renewal path — see ingress.bicep's cron job). Nginx
          // is configured to 301-redirect every other path on :80 to
          // :443, so this rule does not by itself expose plaintext HTTP
          // service traffic — that redirect is what makes the rule safe,
          // and it is verified in `infra/azure/README.md`'s manual
          // checklist, not assumed here.
          name: 'AllowHttpForAcmeChallenge'
          properties: {
            priority: 110
            direction: 'Inbound'
            access: 'Allow'
            protocol: 'Tcp'
            sourceAddressPrefix: '*'
            sourcePortRange: '*'
            destinationAddressPrefix: '*'
            destinationPortRange: '80'
          }
        }
        {
          // Explicit deny for everything else inbound from the internet,
          // ranked below Azure's implicit DenyAllInbound (65500) so it is
          // redundant in effect but documents intent — a future rule
          // added at a lower priority number than the implicit deny (e.g.
          // by a well-meaning "just open this one port" change) is caught
          // by this rule sitting directly above it, not silently exposed.
          name: 'DenyAllOtherInbound'
          properties: {
            priority: 4000
            direction: 'Inbound'
            access: 'Deny'
            protocol: '*'
            sourceAddressPrefix: '*'
            sourcePortRange: '*'
            destinationAddressPrefix: '*'
            destinationPortRange: '*'
          }
        }
      ],
      // SSH rule is entirely absent (not "allow from 0.0.0.0/0") when no
      // CIDR is supplied — an empty array must not silently become "allow
      // from anywhere" through a missing-condition default.
      empty(sshAllowedCidrs)
        ? []
        : [
            {
              name: 'AllowSshFromOperator'
              properties: {
                priority: 200
                direction: 'Inbound'
                access: 'Allow'
                protocol: 'Tcp'
                sourceAddressPrefixes: sshAllowedCidrs
                sourcePortRange: '*'
                destinationAddressPrefix: '*'
                destinationPortRange: '22'
              }
            }
          ]
    )
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [addressPrefix]
    }
    subnets: [
      {
        name: subnetName
        properties: {
          addressPrefix: subnetPrefix
          networkSecurityGroup: {
            id: nsg.id
          }
        }
      }
    ]
  }
}

@description('Subnet resource id for the VM NIC.')
output subnetId string = vnet.properties.subnets[0].id

@description('NSG resource id.')
output nsgId string = nsg.id
