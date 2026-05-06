// main.ts
import { loadConfig } from './config.ts'
import { connectDB, runMigrations } from './db.ts'
import { registerAll } from './gamemodes/register_modes.ts'
import { createServer } from './server.ts'

// Register gamemodes
registerAll()

console.log('Starting PvP Ranked backend...')

const config = loadConfig()

const db = await connectDB(config.databaseUrl)
await runMigrations(db)

const app = createServer(config, db)

console.log(`Server running at http://localhost:${config.port}`)

Deno.serve({ port: config.port }, app.fetch)