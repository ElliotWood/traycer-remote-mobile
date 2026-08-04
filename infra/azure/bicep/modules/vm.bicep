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

@description('Private repos agents on this VM need checked out, as `<owner>/<repo>@<branch>` strings. First boot mints a deploy key per repo and prints its PUBLIC key into the cloud-init log; the clone only succeeds once a human registers that key on the repo (`gh repo deploy-key add --allow-write`). See bootstrap.sh\'s repo-checkout phase for why that step is deliberately not automated, and infra/azure/README.md for the deploy-key-vs-PAT reasoning.')
param repoSpecs array = []

var namePrefix = 'altra'
var vmName = '${namePrefix}-vm-${workload}-${regionAbbrev}'
var nicName = '${namePrefix}-nic-${workload}-${regionAbbrev}'
var pipName = '${namePrefix}-pip-${workload}-${regionAbbrev}'
var dnsLabel = '${namePrefix}-${workload}-${regionAbbrev}'

var osUser = 'traycer'
var homeRoot = '/srv/traycer/tenants'
var tenantIdsSpaceSeparated = join(tenantIds, ' ')
var repoSpecsSpaceSeparated = join(repoSpecs, ' ')

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

// The WebSocket deflate relay and A6's end-to-end probe for it. Both were
// committed and both ran on the live VM, but NEITHER was referenced here
// or in bootstrap.sh - so a rebuilt VM would have come up without the
// relay (breaking epic loading outright) and without the probe that
// watches it, with nothing failing at deploy time to say so. Exactly the
// "committed, looks done, silently absent on rebuild" gap this epic keeps
// finding, so they are wired in together rather than left to a manual
// step someone has to remember.
var relayProbeScript = loadTextContent('../../scripts/traycer-relay-probe.mjs')
var relayProbeUnitTemplate = loadTextContent('../../systemd/traycer-relay-probe.service')
var relayProbeTimerTemplate = loadTextContent('../../systemd/traycer-relay-probe.timer')

// A6 agent-execution surface probe: the `claude` binary, an AUTH-BEARING
// credential (not merely a present `.claude.json` - see the script's
// header for why that distinction was a real false-green), and repo git
// health as the owning user. Structural mode only on the timer; the
// quota-consuming `--spawn` mode is deliberately not scheduled.
var agentProbeScript = loadTextContent('../../scripts/traycer-agent-probe.sh')
var agentProbeUnitTemplate = loadTextContent('../../systemd/traycer-agent-probe@.service')
var agentProbeTimerTemplate = loadTextContent('../../systemd/traycer-agent-probe@.timer')

// The --spawn variant: one real Claude call every 6h, the only check that
// proves the token is VALID rather than merely present and delivered.
// Costs shared Claude Max quota per run - a separate, slower timer from
// the free structural probe above, not a flag on it, so the spend is an
// explicit unit an operator can see and disable independently.
var agentSpawnProbeUnitTemplate = loadTextContent('../../systemd/traycer-agent-spawn-probe@.service')
var agentSpawnProbeTimerTemplate = loadTextContent('../../systemd/traycer-agent-spawn-probe@.timer')

// Private-repo access: deploy-key minting + the shared clone. Embedded the
// same way as everything above, so a rebuilt VM has both scripts on disk
// even when `repoSpecs` is empty and bootstrap.sh's repo phase is a no-op -
// the operator can then run them by hand without fetching anything.
var ensureDeployKeyScript = loadTextContent('../../scripts/ensure-repo-deploy-key.sh')
var provisionRepoCloneScript = loadTextContent('../../scripts/provision-repo-clone.sh')

// The agent harness itself. Embedded here (rather than left as a manual
// step) because "the VM can run agents" is the entire point of the VM, and
// until this line a rebuilt box came up with no harness installed at all -
// see provision-agent-runtime.sh's header. bootstrap.sh calls it as its last
// phase; it is also re-runnable standalone, which is how an existing box
// recovers without a rebuild.
var agentRuntimeScript = loadTextContent('../../scripts/provision-agent-runtime.sh')

// A2's identity routing - the piece that existed ONLY as a manual change on
// the running VM. A rebuild from the previous version of this file silently
// reproduced the pre-A2 single-tenant relay, with nothing failing at deploy
// time to say so.
//
// `tenant-router.generated.mjs` is a tracked build output (see
// router/build.sh for why it is tracked rather than in dist/, and what
// checks that it is not stale). It is ~16 KB because `ws` and `zod` are
// external and installed by bootstrap.sh, not bundled - fully bundled it was
// 600 KB, which is what made it undeliverable and kept it off this path.
var tenantRouterScript = loadTextContent('../../router/tenant-router.generated.mjs')
var tenantRouterUnitTemplate = loadTextContent('../../systemd/traycer-tenant-router.service')
var registryGenerateScript = loadTextContent('../../scripts/traycer-registry-generate.sh')

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
var provisionScript = '#!/bin/bash\nset -euo pipefail\nexport TRAYCER_OS_USER="${osUser}"\nexport TRAYCER_HOME_ROOT="${homeRoot}"\nexport TRAYCER_TENANT_IDS="${tenantIdsSpaceSeparated}"\nexport TRAYCER_PUBLIC_HOSTNAME="${publicHostname}"\nexport TRAYCER_ACME_EMAIL="${acmeContactEmail}"\nexport TRAYCER_REPOS="${repoSpecsSpaceSeparated}"\n\nmkdir -p /usr/local/bin\ncat > /usr/local/bin/traycer-host-guard.sh <<\'TRAYCER_GUARD_EOF\'\n${guardScript}\nTRAYCER_GUARD_EOF\ncat > /usr/local/bin/traycer-alert.sh <<\'TRAYCER_ALERT_EOF\'\n${alertScript}\nTRAYCER_ALERT_EOF\ncat > /usr/local/bin/traycer-host-failure-alert.sh <<\'TRAYCER_HOSTFAIL_EOF\'\n${hostFailureAlertScript}\nTRAYCER_HOSTFAIL_EOF\ncat > /usr/local/bin/traycer-worktree-rescue.sh <<\'TRAYCER_RESCUE_EOF\'\n${worktreeRescueScript}\nTRAYCER_RESCUE_EOF\ncat > /usr/local/bin/traycer-health-probe.sh <<\'TRAYCER_PROBE_EOF\'\n${healthProbeScript}\nTRAYCER_PROBE_EOF\ncat > /usr/local/bin/traycer-agent-probe.sh <<\'TRAYCER_AGENTPROBE_EOF\'\n${agentProbeScript}\nTRAYCER_AGENTPROBE_EOF\ncat > /usr/local/bin/ensure-repo-deploy-key.sh <<\'TRAYCER_DEPLOYKEY_EOF\'\n${ensureDeployKeyScript}\nTRAYCER_DEPLOYKEY_EOF\ncat > /usr/local/bin/provision-repo-clone.sh <<\'TRAYCER_REPOCLONE_EOF\'\n${provisionRepoCloneScript}\nTRAYCER_REPOCLONE_EOF\ncat > /usr/local/bin/provision-agent-runtime.sh <<\'TRAYCER_AGENTRUNTIME_EOF\'\n${agentRuntimeScript}\nTRAYCER_AGENTRUNTIME_EOF\ncat > /usr/local/bin/traycer-registry-generate.sh <<\'TRAYCER_REGISTRYGEN_EOF\'\n${registryGenerateScript}\nTRAYCER_REGISTRYGEN_EOF\nchmod +x /usr/local/bin/traycer-host-guard.sh /usr/local/bin/traycer-alert.sh /usr/local/bin/traycer-host-failure-alert.sh /usr/local/bin/traycer-worktree-rescue.sh /usr/local/bin/traycer-health-probe.sh /usr/local/bin/traycer-agent-probe.sh /usr/local/bin/ensure-repo-deploy-key.sh /usr/local/bin/provision-repo-clone.sh /usr/local/bin/provision-agent-runtime.sh /usr/local/bin/traycer-registry-generate.sh\n\nmkdir -p /etc/systemd/system\ncat > /etc/systemd/system/traycer-host@.service <<\'TRAYCER_UNIT_EOF\'\n${unitTemplate}\nTRAYCER_UNIT_EOF\ncat > /etc/systemd/system/traycer-host-alert@.service <<\'TRAYCER_HOSTALERT_UNIT_EOF\'\n${hostAlertUnitTemplate}\nTRAYCER_HOSTALERT_UNIT_EOF\ncat > /etc/systemd/system/traycer-health-probe@.service <<\'TRAYCER_PROBE_UNIT_EOF\'\n${healthProbeUnitTemplate}\nTRAYCER_PROBE_UNIT_EOF\ncat > /etc/systemd/system/traycer-health-probe@.timer <<\'TRAYCER_PROBE_TIMER_EOF\'\n${healthProbeTimerTemplate}\nTRAYCER_PROBE_TIMER_EOF\ncat > /etc/systemd/system/traycer-tenant-router.service <<\'TRAYCER_TENANTROUTER_UNIT_EOF\'\n${tenantRouterUnitTemplate}\nTRAYCER_TENANTROUTER_UNIT_EOF\ncat > /etc/systemd/system/traycer-relay-probe.service <<\'TRAYCER_RELAYPROBE_UNIT_EOF\'\n${relayProbeUnitTemplate}\nTRAYCER_RELAYPROBE_UNIT_EOF\ncat > /etc/systemd/system/traycer-relay-probe.timer <<\'TRAYCER_RELAYPROBE_TIMER_EOF\'\n${relayProbeTimerTemplate}\nTRAYCER_RELAYPROBE_TIMER_EOF\ncat > /etc/systemd/system/traycer-agent-probe@.service <<\'TRAYCER_AGENTPROBE_UNIT_EOF\'\n${agentProbeUnitTemplate}\nTRAYCER_AGENTPROBE_UNIT_EOF\ncat > /etc/systemd/system/traycer-agent-probe@.timer <<\'TRAYCER_AGENTPROBE_TIMER_EOF\'\n${agentProbeTimerTemplate}\nTRAYCER_AGENTPROBE_TIMER_EOF\ncat > /etc/systemd/system/traycer-agent-spawn-probe@.service <<\'TRAYCER_AGENTSPAWN_UNIT_EOF\'\n${agentSpawnProbeUnitTemplate}\nTRAYCER_AGENTSPAWN_UNIT_EOF\ncat > /etc/systemd/system/traycer-agent-spawn-probe@.timer <<\'TRAYCER_AGENTSPAWN_TIMER_EOF\'\n${agentSpawnProbeTimerTemplate}\nTRAYCER_AGENTSPAWN_TIMER_EOF\nsed -i "s|__TRAYCER_OS_USER__|${osUser}|g; s|__TRAYCER_HOME_ROOT__|${homeRoot}|g" /etc/systemd/system/traycer-host@.service /etc/systemd/system/traycer-host-alert@.service /etc/systemd/system/traycer-health-probe@.service /etc/systemd/system/traycer-relay-probe.service /etc/systemd/system/traycer-agent-probe@.service /etc/systemd/system/traycer-tenant-router.service /etc/systemd/system/traycer-agent-spawn-probe@.service\n\n# The relay and its probe both `import ... from "ws"`, and Node resolves\n# bare specifiers by walking up from the SCRIPT\'s directory - so both must\n# live beside the one node_modules/ws on the box, NOT in /usr/local/bin.\n# Putting the probe in /usr/local/bin first is exactly how this was found\n# (ERR_MODULE_NOT_FOUND on the very first run).\nmkdir -p /usr/local/lib/traycer\ncat > /usr/local/lib/traycer/tenant-router.mjs <<\'TRAYCER_TENANTROUTER_EOF\'\n${tenantRouterScript}\nTRAYCER_TENANTROUTER_EOF\ncat > /usr/local/lib/traycer/traycer-relay-probe.mjs <<\'TRAYCER_RELAYPROBE_EOF\'\n${relayProbeScript}\nTRAYCER_RELAYPROBE_EOF\n\n${bootstrapScript}\n'

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

// PROVISIONING RUNS HERE, NOT IN customData - and the reason is a hard Azure
// limit, measured rather than read.
//
// `osProfile.customData` caps at 87,380 base64 characters (65,535 raw bytes -
// the same limit in two units, worth stating out loud, because two different
// numbers for one constraint is how a future reader "corrects" it into a
// wrong one). This module's assembled script passed that ceiling some time
// ago: 132,660 base64 characters, ~1.5x over, BEFORE A2's router was added.
//
// THE TRAP, and why nobody noticed: `az deployment group validate` returns
// "error": null on the oversized template. So does what-if. Only
// `az deployment group create` rejects it:
//   InvalidParameter, target osProfile.customData:
//   "Custom data in OSProfile must be in Base64 encoding and with a maximum
//    length of 87380 characters."
// A validator that passes what the API refuses is not a check. Anyone who
// audited this file with `validate` got a green that meant nothing.
//
// THE SECOND CEILING, and it is the one that decided the mechanism below.
//
// An earlier version of this comment claimed the CustomScript extension's
// ceiling was "far higher" and that this template "sits well inside it". That
// was wrong and is corrected here rather than deleted, because a confident
// comment recording a disproved belief answers the question for the next
// reader and stops them looking.
//
// ARM refuses any template expression whose EVALUATED RESULT exceeds 131,072
// characters. `base64(provisionScript)` is such an expression, and base64
// inflates by 4/3, so the operative budget for the raw script under any
// mechanism that needs base64 is 98,304 bytes - not 131,072.
//
//   raw provisionScript   123,421 bytes
//   base64 of it          164,564 characters
//   ARM's limit           131,072
//   headroom, plaintext     7,651 characters (5.8%)
//
// 🔴 THOSE FOUR NUMBERS ARE A SNAPSHOT, THEY MOVE, AND THE DIRECTION IS ONE
// WAY. Measured at `node infra/azure/scripts/measure-provision-payload.mjs`,
// 2026-08-04. Over a single afternoon's work on this directory they went:
//
//   117,927 -> 120,701 -> 122,575 -> 123,421   headroom 10.0% -> 5.8%
//
// 🔴 AND IT IS NOT A CONSTANT ACROSS DEPLOYMENTS. That figure is for the
// measurer's own placeholder parameters. The real payload varies with the
// LENGTH of `publicHostname`, `acmeContactEmail` and the tenant list, which
// are interpolated into the script: the A0 scratch deploy's actual payload was
// 122,569 bytes while the measurer read 122,575 for the same tree. The gate is
// still a gate; the number is per-parameter-set, so do not treat a figure
// quoted here as what YOUR deployment will send.
//
// 🔴 AND DO NOT VERIFY IT WITH `az` ON WINDOWS - `az --query "source.script"`
// silently drops non-ASCII characters (88 of them, measured) with a WARNING
// and exit 0, always UNDER-reporting. See measure-provision-payload.mjs's
// header for the raw-REST command that returns the real bytes.
//
// Nothing in those three steps added a feature. Each was COMMENTS added to
// provisioned scripts - every byte of every file this template carries lands
// in the same budget, and this repo comments heavily on purpose. That is a
// defensible trade, but it is a trade, and at this rate the ceiling binds
// before any new capability does.
//
// So: do not trust the figures above, run the command. It exits non-zero when
// the payload stops fitting, which makes it a gate and not only a report -
// wire it into anything that gates this directory. When it does go red, the
// fix is a SECOND runCommands resource split at a phase boundary, not a
// comment cull; see the note on why concat() cannot help.
//
// It evaluates this template's own `provisionScript` expression rather than
// summing the loadTextContent sources: `wc -c` over those undercounts, since
// the assembly wraps each one in heredoc scaffolding.
// It evaluates this template's own `provisionScript` expression rather than
// summing the loadTextContent sources - `wc -c` over those undercounts, since
// the assembly wraps every one of them in heredoc scaffolding. That script
// exits non-zero when the payload no longer fits, so this is a gate and not
// only a report.
//
// THE SPLIT THAT DOES NOT WORK, recorded so it is not re-attempted. Splitting
// the script into two under-limit literals joined with `concat()` fails, and
// it fails DIFFERENTLY, which is what makes it look like it might have worked:
//
//   one expression, 157,256 chars:
//     "The template language expression literal limit exceeded.
//      Limit: '131072' and actual: '157256'."
//   concat() of two 78,628-char halves, each individually under the limit:
//     "The result of the template language expression exceeds the maximum
//      length limit of 131072 characters."
//
// Same ceiling, applied to the RESULT. A split only buys anything when the
// halves land in SEPARATE PROPERTIES - which is what multiple `runCommands`
// resources give you, and what a `concat()` inside one property never can.
//
// Both of those are reproducible in about a minute with NO resource group, NO
// VM and NO public IP - a subscription-scoped deployment with `resources: []`
// and the expression under test in an `outputs` block:
//   infra/azure/scripts/probe-arm-expression-limit.sh
// Run it before believing any size claim in this file, these included. It
// carries a negative control (130,668 chars, just under: ACCEPTED) precisely
// so that the two refusals cannot be explained by "the probe refuses
// everything" - a check that cannot pass proves as little as one that cannot
// fail.
//
// AND `validate` PASSES ALL OF THEM. `az deployment ... validate` returns
// "error": null for every case above, including the two the identical
// template is about to be refused for. A validator that passes what the API
// refuses is not a check, and "validate was clean" is not evidence about size.
//
// WHY runCommands AND NOT CustomScript. `runCommands` takes the script as
// PLAINTEXT, so it pays no base64 tax: 117,939 < 131,072 fits today with
// ~11% headroom. `runCommands` is also an ordinary child resource type, so
// there can be MANY per VM - when this payload does outgrow one, the fix is a
// second resource split at a phase boundary, and that split works precisely
// because the halves are then separate properties. A VM may have only one
// CustomScript extension, so that escape route does not exist there.
//
// WHY THIS AND NOT A FETCH. Everything the VM needs is still inline in this
// template, via `loadTextContent` over tracked files. No storage account, no
// blob, no clone at boot - nothing whose contents can differ from the sources
// that produced them. Swapping a size limit for bytes living outside the IaC
// would relocate the exact drift this change exists to remove.
//
// THE REAL REASON, beyond size: this is re-appliable to a RUNNING VM. The
// live host has never executed this template's provisioning at all - its
// cloud-init payload predates almost everything in this directory - and under
// customData that could only be corrected by rebuilding a production box,
// which nobody was ever going to do. "The repo and the VM disagree" now has a
// remedy rather than only a diagnosis.
//
// 🔴 NOTHING SECRET MAY GO IN `source.script`. This body is readable by
// anyone who can read the resource (`az vm run-command show --instance-view`)
// - unlike an extension's `protectedSettings`, which the previous draft used
// for exactly that reason. It is safe TODAY only because every byte of it is
// already-public tracked repo content. A credential, a token or a private key
// added here is a disclosure at the moment it is added, and nothing about
// adding it would look like publishing a secret. Secrets go in
// `protectedParameters` (write-only, never returned by the API) and are
// referenced from the script as positional parameters - never inlined.
//
// `treatFailureAsDeploymentFailure` is why a broken provisioning script now
// fails the deployment. CustomScript's own success status was not usable for
// this: it reports success for scripts it declines to re-run.
resource provisioning 'Microsoft.Compute/virtualMachines/runCommands@2024-03-01' = {
  parent: vm
  name: 'traycer-provisioning'
  location: location
  properties: {
    source: {
      script: provisionScript
    }
    // The deployment must WAIT for provisioning and fail if it fails. Async
    // would report the deployment green while bootstrap.sh was still running
    // - or had already died - which is the entire failure class this file is
    // being rewritten to remove.
    asyncExecution: false
    treatFailureAsDeploymentFailure: true
    timeoutInSeconds: 3600
    runAsUser: 'root'
  }
  // A content-derived tag, playing the part `forceUpdateTag` played for the
  // extension. uniqueString() is deterministic, so an unchanged script does
  // not churn it.
  //
  // ✅ VERIFIED on the A0 scratch deploy, 2026-08-04, and the two mechanisms
  // this template always moves together were separated with direct REST PUTs
  // so each could be tested alone:
  //
  //   nothing changed (identical redeploy)   NOT re-executed  <- the control
  //   tag changed, script byte-identical     re-executed
  //   script changed, tag held constant      re-executed
  //   one byte inside a loadTextContent file re-executed, and the byte landed
  //
  // The control row is what makes the others mean anything: re-execution is
  // NOT unconditional, so the re-runs were caused by the change and not by
  // deploying. Each mechanism is independently sufficient - so the earlier
  // belief that a `source.script` change alone suffices is now observed true,
  // and this tag is genuine belt-and-braces rather than the load-bearing part.
  // Keep it: it costs nothing and it removes the dependency on provider update
  // semantics that could change under us without notice.
  tags: {
    'traycer-provision-content': uniqueString(provisionScript)
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
