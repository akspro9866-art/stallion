/**
 * HTTP request helpers for the mock bridge (extracted from mock/server.ts; behaviour unchanged).
 */

import http from 'node:http'

const MAX_BODY_BYTES = 32 * 1024 * 1024

export function bearerOk(request: http.IncomingMessage, token: string): boolean {
	if (!token) return true
	const header = request.headers.authorization ?? ''
	return header === `Bearer ${token}`
}

export function readBody(request: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		let size = 0
		request.on('data', (chunk: Buffer) => {
			size += chunk.length
			if (size > MAX_BODY_BYTES) {
				reject(new Error('request body too large'))
				request.destroy()
				return
			}
			chunks.push(chunk)
		})
		request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
		request.on('error', reject)
	})
}
