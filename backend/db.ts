// Database handling

// i hate sql

import postgres from 'postgres'

// Export the type using typeof so it always matches regardless of how postgres resolves its internal types
export type DB = ReturnType<typeof postgres>

export async function connectDB(databaseUrl: string): Promise<DB> {
    const sql = postgres(databaseUrl, {
        max:             25,
        idle_timeout:    30,
        connect_timeout: 10,
        onnotice:        () => {},
    })

    await sql`SELECT 1`
    console.log('Connected to PostgreSQL')

    return sql
}

export async function runMigrations(sql: DB): Promise<void> {
    await sql`
        CREATE TABLE IF NOT EXISTS _migrations (
            name    TEXT PRIMARY KEY,
            run_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
`

    const files: string[] = []
    for await (const entry of Deno.readDir('./migrations')) {
        if (entry.name.endsWith('.up.sql')) files.push(entry.name)
    }
    files.sort()

    for (const file of files) {
        const rows = await sql`SELECT name FROM _migrations WHERE name = ${file}`
        if (rows.length > 0) {
            console.log(`Migration already applied: ${file}`)
            continue
        }
        const sql_text = await Deno.readTextFile(`./migrations/${file}`)
        await sql.unsafe(sql_text)
        await sql`INSERT INTO _migrations (name) VALUES (${file})`
        console.log(`Migration applied: ${file}`)
    }
}