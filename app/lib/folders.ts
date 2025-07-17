import { Router } from 'jsr:@oak/oak/router';

import { getClient } from "../storage/adapter.ts";
import { requireAuthentication } from '../middleware/require-authentication.ts';

import projects from './projects.ts';

import { Context } from "jsr:@oak/oak/context";

const router = new Router();

router.use(requireAuthentication);

router.get('/', async ({ response }: Context) => {
    const db = await getClient();
    const stmt = db.prepare(`
        SELECT
            uuid, 
            folder_name, 
            description,
            created_at,
            updated_at
        FROM
            folders;    
    `);

    const rows = await stmt.values();

    const folders = rows.map(r => {
        const [ id, folder_name, description, created_at, updated_at ] = r;
        return { id, folder_name, description, created_at, updated_at };
    });

    response.body = {
        folders,
    };
});

router.post('/', async ({ request, response }: Context) => {
    const folder = await request.body.json();

    const db = await getClient();
    const uuid = crypto.randomUUID();

    try {
        const stmt = db.prepare(`
            INSERT INTO folders
                (uuid, folder_name, description, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?)
            RETURNING
                uuid, folder_name, description, created_at, updated_at
        `);
    
        const now = new Date().toISOString();
        const row = await stmt.value(
            uuid,
            folder.folder_name,
            folder.description || '',
            now,
            now
        );

        if (!row) {
            response.status = 500;
            response.body = {
                message: "no return value from create",
            }
            return;
        }
        
        const [id, folder_name, description, created_at, updated_at] = row;

        response.status = 201;
        response.body = {
            folder: {
                id,
                folder_name,
                description,
                created_at,
                updated_at
            }
        };
        return;
    } catch (e) {
        response.status = 500;
        response.body = {
            message: e
        }

        if (e.message.includes('UNIQUE constraint failed')) {
            response.status = 409;
            response.body = {
                message: 'project name must be unique',
            }
        }
    }
});

router.get('/:folder_name', async ({ params, response }) => {
    const name = params.folder_name;

    const db = await getClient();
    const stmt = db.prepare(`
        SELECT
            uuid, 
            folder_name, 
            description,
            created_at,
            updated_at
        FROM
            folders
        WHERE
            folder_name = ?
    `);
    const row = stmt.value(name);

    if (!row) {
        response.status = 404;
        return;
    }

    const [id, folder_name, description, created_at, updated_at] = row;
    response.body = {
        folder: {
            id,
            folder_name,
            description,
            created_at,
            updated_at
        }
    }
});

router.delete('/:folder_name', async ({params, response}) => {
    const { folder_name } = params;

    const db = await getClient();
    const stmt = db.prepare(`
        DELETE FROM 
            folders
        WHERE
            folder_name = ?;
    `);
    try {
        await stmt.run(folder_name);
        response.status = 204;
        return;
    } catch (e) {
        response.status = 500;
        response.body = { message: e }

        if (e.message.includes('FOREIGN KEY constraint failed')) {
            response.status = 400;
            response.body = {
                message: 'cannot delete folder while child projects still exist'
            }
        }
    }

});

router.use('/:folder_name/projects', projects.routes(), projects.allowedMethods());

export default router;