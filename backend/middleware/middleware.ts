// In between mc server and backend. Modify requests and responses, handle auth, rate limiting, etc.

import { type Context, type Next } from 'hono'
import type { Config } from '../config.ts'
import { verifyAccessToken } from '../auth/jwt.ts'

// --- Logger ---
export function logger() {
    return async (c: Context, next: Next) => {
        const start = Date.now()
        await next()
        const ms     = Date.now() - start
        const status = c.res.status
        // Colour-code by status range for readability in dev
        const colour = status >= 500 ? '31' : status >= 400 ? '33' : status >= 200 ? '32' : '0'
        console.log(`\x1b[${colour}m${c.req.method} ${c.req.path} ${status} ${ms}ms\x1b[0m`)
    }
}

// --- CORS ---
export function cors(cfg: Config) {
    return async (c: Context, next: Next) => {
        const origin = cfg.environment === 'production'
            ? 'https://yourdomain.com'
            : '*'
        c.header('Access-Control-Allow-Origin',  origin)
        c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        if (c.req.method === 'OPTIONS') return c.text('', 204)
        await next()
    }
}

// --- Rate Limiter ---
// Sliding window per IP. In production this is replaced by the Redis-backed
// version in Phase 6 so it works across multiple server instances.
type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export function rateLimit(limit = 120, windowMs = 60_000) {
    return async (c: Context, next: Next) => {
        const ip  = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
        const now = Date.now()

        let bucket = buckets.get(ip)
        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs }
            buckets.set(ip, bucket)
        }
        bucket.count++

        // Set standard rate limit headers so clients know their status
        c.header('X-RateLimit-Limit',     String(limit))
        c.header('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)))
        c.header('X-RateLimit-Reset',     String(Math.ceil(bucket.resetAt / 1000)))

        if (bucket.count > limit) {
            return c.json({ error: 'Rate limit exceeded' }, 429)
        }
        await next()
    }
}

// --- Security headers ---
// Adds headers that protect against common web attacks.
// Particularly important if you ever serve a web dashboard.
export function securityHeaders() {
    return async (c: Context, next: Next) => {
        await next()
        c.header('X-Content-Type-Options',  'nosniff')
        c.header('X-Frame-Options',         'DENY')
        c.header('X-XSS-Protection',        '1; mode=block')
        c.header('Referrer-Policy',         'strict-origin-when-cross-origin')
        // Only send HSTS in production — breaks local dev with self-signed certs
        if (c.req.url.startsWith('https://')) {
            c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
        }
    }
}

// --- Auth ---
export function requireAuth(jwtSecret: string) {
    return async (c: Context, next: Next) => {
        const auth = c.req.header('Authorization')
        if (!auth?.startsWith('Bearer ')) {
            return c.json({ error: 'Missing or invalid Authorization header' }, 401)
        }
        try {
            const payload = await verifyAccessToken(auth.replace('Bearer ', ''), jwtSecret)
            c.set('playerUuid',     payload.uuid)
            c.set('playerUsername', payload.username)
        } catch {
            return c.json({ error: 'Invalid or expired token' }, 401)
        }
        await next()
    }
}

// --- Server secret ---
export function requireServerSecret(secret: string) {
    return async (c: Context, next: Next) => {
        const provided = c.req.header('X-Server-Secret')
        if (!provided || provided !== secret) {
            return c.json({ error: 'Invalid server secret' }, 401)
        }
        await next()
    }
}