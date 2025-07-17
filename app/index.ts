import { Database } from 'jsr:@db/sqlite@0.11';
import { Application } from 'jsr:@oak/oak/application';
import { Router } from 'jsr:@oak/oak/router';
import { Context } from 'jsr:@oak/oak/context';
import { Next } from 'jsr:@oak/oak/middleware';
import { stringToURL } from "jsr:@denosaurs/plug@1/util";

// types
type ConnectionDetails = {
  databaseFile: string;
}

type ServerConfig = {
  databaseFile: string
  port: number,
}

// DB stuff
let db: Database | null = null;

const getClient = async (): Promise<Database> => {
  if (!db) throw new Error('DB connection not setup');

  return await Promise.resolve(db);
}

const setup = async ({ databaseFile }: ConnectionDetails) => {
  db = new Database(databaseFile);

  const setup = db.prepare(`
    CREATE TABLE IF NOT EXISTS data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      
      data varchar(1000),
      
      created_at varchar(25) NOT NULL,
      updated_at varchar(25)
      );
  `);

  await setup.run()
      
  const [version] = await db.prepare('select sqlite_version()').value<[string]>()!;
  console.log(`[ DATABASE ] :: connection verified - sqlite version ${version}`);
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

  const client = await getClient();

  try {
    const stmt = client.prepare(`
      INSERT INTO data 
        (data, created_at)
      VALUES (?, ?)
      RETURNING 
        id, data, created_at, updated_at
    `);
    const now = new Date().toISOString();
    const row = await stmt.value(
      body.data,
      now,
    );

    if (!row) {
      response.status = 500;
      response.body = {
        message: '🤷🦞🥦'
      }
      return
    }

    const [ id, data, created_at, updated_at ] = row;

    response.status = 201;
    response.body = {
      data: {
        id, data, created_at, updated_at
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

dataRouter.get('/:id', async ({ params, response }) => {
  const identifier = params.id;

  const client = await getClient();

  try {
    const stmt = client.prepare(`
      SELECT
        id, data, created_at
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

    const [id, data, created_at] = row;

    response.status = 200;
    response.body = {
      data: {
        id, data, created_at
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