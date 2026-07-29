// A0 (ingress) + A1 (multi-tenant host supervision) — infrastructure-as-code
// only. This file provisions NOTHING by running `bicep build`; it is
// deployed with `az deployment group create` (or previewed with
// `--what-if`), and neither has been run against a real subscription as
// part of this ticket — see infra/azure/README.md for the verification
// commands actually executed and their output.
//
// Deliberately subscription-agnostic: no subscription id, tenant id, or
// resource group name is hardcoded anywhere in this template or its
// modules. Every environment-specific value is a parameter, supplied at
// deploy time via a `.bicepparam` file that is itself gitignored (see
// `main.example.bicepparam` for the shape, with placeholder values only).
//
// Scope: this template provisions the VM, networking, ingress reverse
// proxy, and the systemd scaffolding for per-tenant host supervision (A1).
// It does NOT provision: the identity registry (A2, a separate ticket, own
// worktree), the Teams bot resources, or DNS zone delegation (assumed to
// already exist — see `dnsZoneName`'s parameter doc).
targetScope = 'resourceGroup'

@description('Azure region for every resource. Must match the resource group\'s region (enforced by the module, not assumed).')
param location string = resourceGroup().location

@description('Short workload identifier used to build every resource name via the repo convention `altra-<type>-<workload>-<regionAbbrev>`. Keep short (Azure has per-resource-type name length limits); this ticket used `traycer-host` when validating the template, but the value itself is a parameter, never baked in.')
param workload string

@description('3-4 letter region abbreviation for naming, matching this subscription\'s existing convention (`aue` for australiaeast). Not derived from `location` automatically because the convention is a naming-only abbreviation, not a real Azure region code.')
param regionAbbrev string

@description('VM administrator username. No default: an operator must choose one explicitly rather than inherit a guessable default. SSH key auth only (see `adminSshPublicKey`) — password auth is disabled by the VM module unconditionally.')
param adminUsername string

@description('SSH public key for the admin account. Required — this template does not support password authentication for the VM at all, so there is no path where a weak/default password could ship.')
@secure()
param adminSshPublicKey string

@description('VM size. Defaults to `Standard_D4s_v3` (4 vCPU / 16 GiB) - chosen for quota, not for fit. `Standard_D4as_v5` looks nominally consistent with `altra-ab-sensormine-demo-aue`, an existing resource in this subscription, but the `Standard DASv5 Family vCPUs` quota is 0 on this subscription (that existing resource already consumes the family\'s entire allotment) - a live deploy attempt with the AMD SKU failed on quota for exactly this reason. `Standard DSv3 Family vCPUs` had headroom instead (see infra/azure/README.md\'s quota-check prerequisite: check the PER-FAMILY limit, not just `Total Regional vCPUs` - they can diverge sharply and the family limit binds first). Revisit once quota changes or A7 (capacity) measures real per-tenant usage - this value documents what deploys today, not a sizing recommendation.')
param vmSize string = 'Standard_D4s_v3'

@description('Public DNS name the ingress will terminate TLS for (e.g. `traycer.example.com`). The DNS zone/delegation is assumed to already exist and is NOT provisioned by this template — A0\'s ticket describes "real DNS, real certificate", not zone creation, and this subscription\'s existing zone ownership is outside this ticket\'s scope to discover or assert.')
param publicHostname string

@description('Email address used for Let\'s Encrypt / ACME registration and renewal-failure notices (certbot requires one). Not a secret, but still a parameter — never hardcoded to a real person\'s address in committed IaC.')
param acmeContactEmail string

@description('CIDR ranges allowed to reach the VM over SSH (port 22). Empty array means SSH is not opened on the NSG at all — Bastion/JIT access is assumed as the operational answer, consistent with "no secrets, no real hostnames" for a template that must be safe to read cold.')
param sshAllowedCidrs array = []

@description('Existing Azure DNS zone name (e.g. `example.com`) that `publicHostname` is a record within. Empty (the default) skips DNS record creation — this template still does not create or delegate a zone (see this file\'s top comment); this parameter only controls whether it adds ONE record into a zone the operator already owns.')
param dnsZoneName string = ''

@description('List of tenant identifiers this deployment provisions a host-supervision systemd unit for. Each must be a valid POSIX username fragment (lowercase, digits, hyphen) - validated in the `host-supervision` module, not just documented here. Empty by default so a first deploy can stand up ingress/networking before any tenant is onboarded (A3 is the per-person onboarding procedure, sequenced after this ticket).')
param tenantIds array = []

@description('Log Analytics workspace resource id to ship VM/systemd logs to, for A6 (observability, a later ticket) to consume. Optional: omitting it stands up the VM without a monitoring sink rather than forcing this ticket to also design A6\'s alerting.')
param logAnalyticsWorkspaceId string = ''

module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    workload: workload
    regionAbbrev: regionAbbrev
    sshAllowedCidrs: sshAllowedCidrs
  }
}

module vm 'modules/vm.bicep' = {
  name: 'vm'
  params: {
    location: location
    workload: workload
    regionAbbrev: regionAbbrev
    vmSize: vmSize
    adminUsername: adminUsername
    adminSshPublicKey: adminSshPublicKey
    subnetId: network.outputs.subnetId
    nsgId: network.outputs.nsgId
    tenantIds: tenantIds
    logAnalyticsWorkspaceId: logAnalyticsWorkspaceId
    publicHostname: publicHostname
    acmeContactEmail: acmeContactEmail
  }
}

module ingress 'modules/ingress.bicep' = {
  name: 'ingress'
  params: {
    dnsZoneName: dnsZoneName
    publicHostname: publicHostname
    vmPublicIpAddress: vm.outputs.publicIpAddress
  }
}

@description('Public IP address to point the DNS A/AAAA record at (created by the `network` module, attached to the VM by the `vm` module).')
output publicIpAddress string = vm.outputs.publicIpAddress

@description('FQDN Azure assigned the public IP (azure-native fallback name; the real public hostname is `publicHostname`, pointed at this IP out-of-band once DNS is confirmed delegated).')
output azurePublicFqdn string = vm.outputs.publicFqdn

@description('VM resource id, for the onboarding procedure (A3) and any later ticket that needs to reference this host.')
output vmResourceId string = vm.outputs.vmResourceId

@description('True if `dnsZoneName` was supplied and a matching A record was created. False means the operator must point DNS at `publicIpAddress` manually before certbot can obtain a certificate (see bootstrap.sh\'s two-phase nginx/certbot comment).')
output dnsRecordCreated bool = ingress.outputs.dnsRecordCreated
