provider "vault" {
  address = "http://127.0.0.1:8200"
  token   = "root"
}

resource "vault_mount" "transit" {
  path = "transit"
  type = "transit"
}

resource "vault_transit_secret_backend_key" "legal_key" {
  backend = vault_mount.transit.path
  name    = "legal"

  exportable = false
  allow_plaintext_backup = false
  deletion_allowed = true
}

resource "vault_transit_secret_backend_key" "medical_key" {
  backend = vault_mount.transit.path
  name    = "medical"
  
  exportable = false
  allow_plaintext_backup = false
  deletion_allowed = true
}