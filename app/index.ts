import { Database } from 'jsr:@db/sqlite';
import { Application } from 'jsr:@oak/oak/application';
import { Router } from 'jsr:@oak/oak/router';
import { Context } from 'jsr:@oak/oak/context';
import { Next } from 'jsr:@oak/oak/middleware';

// types
type ConnectionDetails = {
  databaseFile: string;
}

type ServerConfig = {
  databaseFile: string,
  port: number,
}

type TransitEncryptResponse = {
  data: {
    ciphertext: string;
    key_version: number;
  }
}

type TransitDecryptResponse = {
  data: {
    plaintext: string;
    key_version: number;
  }
}


// DB stuff
let db: Database | null = null;

async function getClient(): Promise<Database> {
  if (!db) throw new Error('DB connection not setup');

  return await Promise.resolve(db);
}

async function setup({ databaseFile }: ConnectionDetails) {
  db = new Database(databaseFile);

  const setup = db.prepare(`
    CREATE TABLE IF NOT EXISTS data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      
      data varchar(1000),
      keyname varchar(10) NOT NULL,
      
      created_at varchar(25) NOT NULL,
      updated_at varchar(25)
    );
  `);

  await setup.run()
      
  const [version] = await db.prepare('select sqlite_version()').value<[string]>()!;
  console.log(`[ DATABASE ] :: connection verified - sqlite version ${version}`);
}

// Vault stuff
async function encryptWithVault(data: string, key: string) {
  const VAULT_TOKEN= Deno.env.get('VAULT_TOKEN');
  const VAULT_ADDR = Deno.env.get('VAULT_ADDR');

  const b64 = btoa(JSON.stringify(data));

  const body = JSON.stringify({ plaintext: b64 });

  const res = await fetch(`${VAULT_ADDR}/v1/transit/encrypt/${key}`, {
    method: 'POST',
    body,
    headers: {
      'X-Vault-Token': `${VAULT_TOKEN}`,
      'content-type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error('unable to encrypt');
  }

  const json = await res.json() as TransitEncryptResponse;

  const encryptedData = json.data.ciphertext;

  return encryptedData;
}

async function decryptWithVault(ciphertext: string, key: string) {
  const VAULT_TOKEN = Deno.env.get('VAULT_TOKEN');
  const VAULT_ADDR = Deno.env.get('VAULT_ADDR');

  const body = JSON.stringify({ ciphertext });

  const res = await fetch(`${VAULT_ADDR}/v1/transit/decrypt/${key}`, {
    method: 'POST',
    body,
    headers: {
      'X-Vault-Token': `${VAULT_TOKEN}`,
      'content-type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error('unable to encrypt');
  }

  const { data } = await res.json() as TransitDecryptResponse;

  const json = atob(data.plaintext);
  const text = JSON.parse(json);
  return text;
}

// middleware
export const logger = async (context: Context, nextFn: Next) => {
  const { request } = context;

  console.log(`[ ${request.method} ] ::  ${request.url} - ${new Date().toISOString()}`);

  await nextFn();
}

// handlers
const dataRouter = new Router();

dataRouter.post('/', async ({ request, response }) => {
  const body = await request.body.json();
  const { data, key } = body;

  const client = await getClient();
  let encryptedData;

  try {
    encryptedData = await encryptWithVault(data, key);
  } catch (e) {
    response.status = 500;
    response.body = {
      message: '👻'
    }
    return;
  }
  try {
    const stmt = client.prepare(`
      INSERT INTO data 
        (data, keyname, created_at)
      VALUES 
        (?, ?, ?)
      RETURNING 
        id, data, keyname, created_at, updated_at
    `);
    const now = new Date().toISOString();
    const row = await stmt.value(
      encryptedData,
      key,
      now,
    );

    if (!row) {
      response.status = 500;
      response.body = {
        message: '🤷🦞🥦'
      }
      return
    }

    const [ id, data, keyname, created_at, updated_at ] = row;

    response.status = 201;
    response.body = {
      data: {
        id, data, created_at, key: keyname, updated_at
      }
    }
    return;
  } catch (e) {
    console.log(e);
    response.status = 500;
    response.body = {
      message: e
    }
  }
});

dataRouter.get('/:id', async ({ params, response }) => {
  const identifier = params.id;

  const client = await getClient();

  try {
    const stmt = client.prepare(`
      SELECT
        id, data, keyname, created_at
      FROM 
        data
      WHERE
        id = ?
    `);

    const row = await stmt.value(identifier);

    if (!row) {
      response.status = 404;
      response.body = {
        message: 'aint no row for that id'
      }
      return
    }

    const [id, data, keyname,  created_at] = row;

    const decryptedText = await decryptWithVault((data as string), (keyname as string));

    response.status = 200;
    response.body = {
      data: {
        id, 
        data: 
        decryptedText, 
        created_at
      }
    }
    return;
  } catch (e) {
    response.status = 500;
    response.body = {
      message: e
    }
  }
});

async function server(config: ServerConfig): Promise<void> {
  const app = new Application();

  app.use(logger);
  
  // cors is for bores
  app.use((ctx, next) => {
    ctx.response.headers.set('access-control-allow-origin', '*');
    ctx.response.headers.set('access-control-allow-headers', '*');
    ctx.response.headers.set('access-control-allow-methods', '*')
    return next();
  })
  
  await setup({ databaseFile: config.databaseFile });
  
  const router = new Router();

  // set JSON as response type
  app.use((ctx, next) => {
    ctx.response.headers.set('content-type', 'application/json');
    return next();
  })
  
  // append the dummy router
  router.use('/data', dataRouter.routes(), dataRouter.allowedMethods());

  app.use(router.routes());
  app.use(router.allowedMethods());
  
  app.addEventListener('listen', ({ hostname, port }) => {
    console.log(`
App started
---
HOST: ${ hostname }
PORT: ${ port }
---
DB:   ${config.databaseFile}
---`);
  });

  await app.listen({ port: config.port });
}

(async function () {
  const port = Deno.env.get('PORT') || 3001;
  const databaseFile = Deno.env.get('SQLITE_DB_PATH') || 'transit-demo.db';

  await server({ port: Number(port), databaseFile });
})();