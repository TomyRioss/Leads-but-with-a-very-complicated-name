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
      $null = Invoke-RestMethod -Uri "$($settings.POCKETBASE_URL)/api/collections/$collection/records?perPage=1&sort=-created" -Headers @{ Authorization = $auth.token }
      "$collection collection with sort: OK"
    } catch {
      "$collection collection: HTTP $([int]$_.Exception.Response.StatusCode)"
    }
  }
} catch {
  "Superuser authentication: HTTP $([int]$_.Exception.Response.StatusCode)"
}
