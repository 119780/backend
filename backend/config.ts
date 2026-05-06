// config.ts

export type Config = {
    port:             number
    environment:      'development' | 'production'
    databaseUrl:      string
    jwtSecret:        string
    jwtAccessMinutes: number
    jwtRefreshDays:   number
    serverSecret:     string
    // Phase 5 — game server management
    dockerEnabled:    boolean  // false in dev, true in production
    backendUrl:       string   // URL game servers POST results back to
    serverHost:       string   // your public IP sent to players on match found
}

export function loadConfig(): Config {
    return {
        port:             parseInt(getEnv('PORT', '8080')),
        environment:      getEnv('ENVIRONMENT', 'development') as Config['environment'],
        databaseUrl:      requireEnv('DATABASE_URL'),
        jwtSecret:        requireEnv('JWT_SECRET'),
        jwtAccessMinutes: parseInt(getEnv('JWT_ACCESS_MINUTES', '15')),
        jwtRefreshDays:   parseInt(getEnv('JWT_REFRESH_DAYS', '7')),
        serverSecret:     requireEnv('SERVER_SECRET'),
        dockerEnabled:    getEnv('DOCKER_ENABLED', 'false') === 'true',
        backendUrl:       getEnv('BACKEND_URL', 'http://localhost:8080'),
        serverHost:       getEnv('SERVER_HOST', '127.0.0.1'),
    }
}

function getEnv(key: string, fallback: string): string {
    return Deno.env.get(key) ?? fallback
}

function requireEnv(key: string): string {
    const value = Deno.env.get(key)
    if (!value) throw new Error(`Missing required env var: "${key}"`)
    return value
}