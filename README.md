## Getting started

1. Install Deno

```sh
# install deno
curl -fsSL https://deno.land/install.sh | sh
```

2. Start vault
```sh
vault server -dev -dev-root-token-id=root
```

3. Run TF to setup Vault
```sh
cd tf
terraform init
terraform apply
```

4. Start the app
```sh
VAULT_TOKEN=... VAULT_ADDR=... deno run dev
```

5. Do some stuff!

```sh
# create a new record
curl --location 'http://localhost:4199/data' \
--header 'Content-Type: application/json' \
--data '{
    "data": "he is very UNWELL",
    "key": "medical"
}'


# get data back
curl --location 'http://localhost:4199/data/<id>'
```