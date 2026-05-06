// Uses Deno's built-in Web Crypto API to implement JWT signing and verification

export type AccessTokenPayload = {
    uuid:     string
    username: string
    exp:      number
}

function getKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    )
}

function toBase64url(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromBase64url(str: string): string {
    return atob(str.replace(/-/g, '+').replace(/_/g, '/'))
}

export async function signAccessToken(
    uuid: string,
    username: string,
    secret: string,
    expiryMinutes: number,
): Promise<string> {
    const key     = await getKey(secret)
    const encoder = new TextEncoder()

    const header  = toBase64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).buffer as ArrayBuffer)
    const payload = toBase64url(encoder.encode(JSON.stringify({
        uuid,
        username,
        exp: Math.floor(Date.now() / 1000) + expiryMinutes * 60,
    })).buffer as ArrayBuffer)

    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`))
    return `${header}.${payload}.${toBase64url(sig)}`
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenPayload> {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('Malformed token')

    const [header, payload, sigB64] = parts
    const key     = await getKey(secret)
    const encoder = new TextEncoder()

    const valid = await crypto.subtle.verify(
        'HMAC',
        key,
        Uint8Array.from(fromBase64url(sigB64), c => c.charCodeAt(0)),
        encoder.encode(`${header}.${payload}`),
    )
    if (!valid) throw new Error('Invalid token signature')

    const data = JSON.parse(fromBase64url(payload)) as AccessTokenPayload
    if (Date.now() / 1000 > data.exp) throw new Error('Token expired')

    return data
}

export function generateRefreshToken(): string {
    const bytes = new Uint8Array(48)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}