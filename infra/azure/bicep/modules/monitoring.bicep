// A6 — unattended operation + alerting. Owns Log Analytics, the Azure
// Monitor Agent extension, and the alert pipeline end to end, rather than
// vm.bicep taking a bring-your-own workspace id it never did anything
// useful with (the old `logAnalyticsWorkspaceId` param this replaces was
// wired but unused until this ticket activated it).
//
// Pipeline: traycer-alert.sh (infra/azure/scripts) writes ONE message
// shape via `logger -t traycer-alert -p local0.crit "..."` -> AMA's
// syslog data source (facility local0) ships it to this workspace's
// `Syslog` table -> a Scheduled Query Alert matches `ProcessName ==
// "traycer-alert"` -> an Action Group emails the operator. One message
// shape end to end is deliberate: two differently-shaped alert paths is
// how a query ends up covering one and silently missing the other - see
// traycer-alert.sh's own module doc.
//
// Chose syslog (facility local0) over a custom-text-log Data Collection
// Rule: `logger` is a standard, always-present CLI, and AMA's syslog data
// source is the well-documented path, not the newer and more fragile
// custom-table/transform-KQL pipeline a bespoke log file would need.
//
// Chose Log Analytics + Action Group over direct SMTP from the VM: Azure
// blocks outbound port 25 on VMs by default, so mail sent directly from
// the box is unreliable rather than merely untested - a constraint
// discovered before building, not after.

@description('Azure region.')
param location string

@description('Workload identifier for naming.')
param workload string

@description('Region abbreviation for naming.')
param regionAbbrev string

@description('Resource id of the VM to monitor and attach the Azure Monitor Agent to.')
param vmResourceId string

@description('Principal id of the VM\'s system-assigned managed identity (vm.bicep\'s `vmPrincipalId` output). AMA authenticates to Azure Monitor via this identity - required for it to ship any data at all, not merely a nicety. Found live: without a role assignment (Monitoring Metrics Publisher, granted below), IMDS returns "Identity not found" and AMA retries forever, shipping nothing, with no error visible anywhere except its own on-box log.')
param vmPrincipalId string

@description('Email address that receives alerts.')
param alertEmailAddress string

@description('Daily ingestion cap in GB, in dollars terms the honest bound on this ticket\'s cost. Log Analytics\' free tier is a quota, not a ceiling - exceeding it bills, it does not refuse. Capping ingestion means the failure mode when the journal gets unexpectedly chatty is "monitoring degrades" (ingestion stops until the next UTC day), never "the bill grows silently" - see infra/azure/README.md for this stated next to the cost estimate, not left as a surprise.')
param dailyQuotaGb int = 1

var namePrefix = 'altra'
var workspaceName = '${namePrefix}-law-${workload}-${regionAbbrev}'
var dcrName = '${namePrefix}-dcr-${workload}-${regionAbbrev}'
var actionGroupName = '${namePrefix}-ag-${workload}-${regionAbbrev}'
var alertRuleName = '${namePrefix}-alert-${workload}-${regionAbbrev}'

resource vmRef 'Microsoft.Compute/virtualMachines@2024-03-01' existing = {
  name: last(split(vmResourceId, '/'))
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: dailyQuotaGb
    }
  }
}

resource monitorAgent 'Microsoft.Compute/virtualMachines/extensions@2024-03-01' = {
  parent: vmRef
  name: 'AzureMonitorLinuxAgent'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Monitor'
    type: 'AzureMonitorLinuxAgent'
    typeHandlerVersion: '1.30'
    autoUpgradeMinorVersion: true
  }
}

resource dcr 'Microsoft.Insights/dataCollectionRules@2023-03-11' = {
  name: dcrName
  location: location
  properties: {
    dataSources: {
      syslog: [
        {
          name: 'traycerAlertSyslog'
          streams: [
            'Microsoft-Syslog'
          ]
          facilityNames: [
            'local0'
          ]
          logLevels: [
            'Debug'
            'Info'
            'Notice'
            'Warning'
            'Error'
            'Critical'
            'Alert'
            'Emergency'
          ]
        }
      ]
    }
    destinations: {
      logAnalytics: [
        {
          name: 'traycerLawDestination'
          workspaceResourceId: workspace.id
        }
      ]
    }
    dataFlows: [
      {
        streams: [
          'Microsoft-Syslog'
        ]
        destinations: [
          'traycerLawDestination'
        ]
      }
    ]
  }
}

// Monitoring Metrics Publisher, scoped to the DCR itself (not the wider
// resource group) - the minimum grant that lets AMA push data through
// THIS rule, nothing else. Deterministic name via `guid()` so a redeploy
// updates this assignment in place rather than erroring on a duplicate -
// `az role assignment create`'s equivalent (used for the live VM's fix,
// before this was added here) generates a random name every call and
// would create a new, redundant assignment on every deploy.
resource amaRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(dcr.id, vmPrincipalId, 'Monitoring Metrics Publisher')
  scope: dcr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
    principalId: vmPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource dcrAssociation 'Microsoft.Insights/dataCollectionRuleAssociations@2023-03-11' = {
  name: '${dcrName}-assoc'
  scope: vmRef
  properties: {
    dataCollectionRuleId: dcr.id
  }
  dependsOn: [
    monitorAgent
    amaRoleAssignment
  ]
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  properties: {
    groupShortName: 'traycerA6'
    enabled: true
    emailReceivers: [
      {
        name: 'ops'
        emailAddress: alertEmailAddress
        useCommonAlertSchema: true
      }
    ]
  }
}

resource alertRule 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: alertRuleName
  location: location
  properties: {
    displayName: 'Traycer A6 host alert'
    description: 'Fires on any traycer-alert syslog line - host failure, restart loop, or functional-unreachable-while-active. See infra/azure/scripts/traycer-alert.sh for the single message shape this query matches, and infra/azure/README.md for the negative-row proof this alert has actually fired.'
    severity: 1
    enabled: true
    scopes: [
      workspace.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: 'Syslog | where ProcessName == "traycer-alert"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
  dependsOn: [
    dcrAssociation
  ]
}

@description('Log Analytics workspace resource id.')
output workspaceId string = workspace.id

@description('Data Collection Rule resource id.')
output dcrId string = dcr.id

@description('Action Group resource id.')
output actionGroupId string = actionGroup.id

@description('Scheduled Query Alert rule resource id.')
output alertRuleId string = alertRule.id
