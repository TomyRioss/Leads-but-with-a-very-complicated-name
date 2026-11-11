$settings = @{}
Get-Content .env.local | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}

$authPayload = @{ identity = $settings.POCKETBASE_SUPERUSER_EMAIL; password = $settings.POCKETBASE_SUPERUSER_PASSWORD } | ConvertTo-Json
try {
  $auth = Invoke-RestMethod -Method Post -Uri "$($settings.POCKETBASE_URL)/api/collections/_superusers/auth-with-password" -ContentType 'application/json' -Body $authPayload
  "Superuser authentication: OK"
  foreach ($collection in @('lead_batches', 'leads')) {
    try {
      $null = Invoke-RestMethod -Uri "$($settings.POCKETBASE_URL)/api/collections/$collection/records?perPage=1" -Headers @{ Authorization = $auth.token }
      "$collection collection with sort: OK"
    } catch {
      "$collection collection: HTTP $([int]$_.Exception.Response.StatusCode)"
    }
  }

  $requiredFields = @{
    users = @('phone', 'credits', 'role', 'verification_sent_at', 'welcome_email_sent_at')
    leads = @('social_profiles', 'source_reviews', 'source_context', 'pain_points_detail', 'enrichment_detail')
  }
  $missingFields = @()
  foreach ($collectionName in $requiredFields.Keys) {
    $schema = Invoke-RestMethod -Uri "$($settings.POCKETBASE_URL)/api/collections/$collectionName" -Headers @{ Authorization = $auth.token }
    $fieldNames = @($schema.fields | ForEach-Object { $_.name })
    $missing = @($requiredFields[$collectionName] | Where-Object { $_ -notin $fieldNames })
    if ($missing.Count -gt 0) {
      $missingFields += $missing | ForEach-Object { "$collectionName.$_" }
    }
  }
  if ($missingFields.Count -gt 0) {
    "Missing PocketBase fields: $($missingFields -join ', ')"
    exit 1
  }
  "Required PocketBase fields: OK"
  $usersSchema = Invoke-RestMethod -Uri "$($settings.POCKETBASE_URL)/api/collections/users" -Headers @{ Authorization = $auth.token }
  $locksSchema = Invoke-RestMethod -Uri "$($settings.POCKETBASE_URL)/api/collections/credit_locks" -Headers @{ Authorization = $auth.token }
  if ($usersSchema.createRule -ne '@request.body.credits = 25 && @request.body.role:isset = false' -or $usersSchema.updateRule) {
    "Unsafe user credits write rules"
    exit 1
  }
  if ($locksSchema.listRule -or $locksSchema.createRule -or $locksSchema.updateRule -or $locksSchema.deleteRule) {
    "Credit locks must remain superuser-only"
    exit 1
  }
  "Credit write rules: OK"
  $sampleUser = Invoke-RestMethod -Uri "$($settings.POCKETBASE_URL)/api/collections/users/records?perPage=1&fields=id,credits" -Headers @{ Authorization = $auth.token }
  if ($sampleUser.items.Count -gt 0) { "Sample user credits: $($sampleUser.items[0].credits)" }
} catch {
  "Superuser authentication: HTTP $([int]$_.Exception.Response.StatusCode)"
}
