import assert from 'node:assert/strict';
import dns from 'node:dns';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import createFetch from '../src';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function startServer(handler: Handler): Promise<{ port: number; close: () => Promise<void> }> {
	const server: Server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const { port } = server.address() as AddressInfo;
	return {
		port,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(c as Buffer));
		req.on('end', () => resolve(Buffer.concat(chunks).toString()));
	});
}

describe('@turist/fetch (undici)', () => {
	it('returns a fetch Response (status / headers.get / text)', async () => {
		const server = await startServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json', 'x-foo': 'bar' });
			res.end(JSON.stringify({ ok: true }));
		});
		const fetch = createFetch();
		const res = await fetch(`http://127.0.0.1:${server.port}/`);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('x-foo'), 'bar');
		assert.deepEqual(JSON.parse(await res.text()), { ok: true });
		await server.close();
	});

	it('serializes object bodies to JSON and sets Content-Type', async () => {
		let received: { ct?: string; body: string } | undefined;
		const server = await startServer(async (req, res) => {
			received = { ct: req.headers['content-type'], body: await readBody(req) };
			res.end();
		});
		const fetch = createFetch();
		await fetch(`http://127.0.0.1:${server.port}/`, { method: 'POST', body: { key: 'value' } });
		assert.equal(received?.body, '{"key":"value"}');
		assert.equal(received?.ct, 'application/json');
		await server.close();
	});

	it('passes Buffer bodies through untouched', async () => {
		let body = '';
		const server = await startServer(async (req, res) => {
			body = await readBody(req);
			res.end();
		});
		const fetch = createFetch();
		await fetch(`http://127.0.0.1:${server.port}/`, { method: 'POST', body: Buffer.from('foo') });
		assert.equal(body, 'foo');
		await server.close();
	});

	it('retries 5xx then succeeds', async () => {
		let calls = 0;
		const server = await startServer((_req, res) => {
			calls++;
			if (calls < 3) {
				res.writeHead(503);
				res.end('busy');
			} else {
				res.writeHead(200);
				res.end('ok');
			}
		});
		const fetch = createFetch();
		const res = await fetch(`http://127.0.0.1:${server.port}/`, {
			retry: { retries: 5, minTimeout: 1, maxTimeout: 5 },
		});
		assert.equal(res.status, 200);
		assert.equal(calls, 3);
		await server.close();
	});

	it('retries 429 (honoring retry-after) then succeeds', async () => {
		let calls = 0;
		const server = await startServer((_req, res) => {
			calls++;
			if (calls === 1) {
				res.writeHead(429, { 'retry-after': '0' });
				res.end('slow down');
			} else {
				res.writeHead(200);
				res.end('ok');
			}
		});
		const fetch = createFetch();
		const res = await fetch(`http://127.0.0.1:${server.port}/`, {
			retry: { retries: 3, minTimeout: 1, maxTimeout: 5 },
		});
		assert.equal(res.status, 200);
		assert.equal(calls, 2);
		await server.close();
	});

	it('returns the last 5xx response after retries are exhausted', async () => {
		let calls = 0;
		const server = await startServer((_req, res) => {
			calls++;
			res.writeHead(500);
			res.end('always down');
		});
		const fetch = createFetch();
		const res = await fetch(`http://127.0.0.1:${server.port}/`, {
			retry: { retries: 1, minTimeout: 1, maxTimeout: 5 },
		});
		assert.equal(res.status, 500);
		assert.equal(calls, 2); // initial + 1 retry
		await server.close();
	});

	it('aborts when the per-request timeout elapses', async () => {
		const server = await startServer(() => {}); // never responds
		const fetch = createFetch();
		await assert.rejects(() =>
			fetch(`http://127.0.0.1:${server.port}/`, { timeout: 150, retry: { retries: 0 } })
		);
		await server.close();
	});

	it('follows redirects and sets res.url to the final URL', async () => {
		const server = await startServer((req, res) => {
			if (req.url === '/final') {
				res.writeHead(200);
				res.end('landed');
			} else {
				res.writeHead(301, { Location: '/final' });
				res.end();
			}
		});
		const fetch = createFetch();
		const res = await fetch(`http://127.0.0.1:${server.port}/start`);
		assert.equal(res.status, 200);
		assert.equal(res.url, `http://127.0.0.1:${server.port}/final`);
		await server.close();
	});

	it('caches DNS resolutions (resolve4 consulted once for two requests)', async () => {
		const server = await startServer((_req, res) => {
			res.writeHead(200, { connection: 'close' });
			res.end('ok');
		});

		// Spy on dns.resolve4 so a fake hostname resolves to loopback and we can
		// count resolutions. connect.lookup -> dnsResolve -> resolve4 -> dns.resolve4.
		const original = dns.resolve4;
		let resolves = 0;
		// @ts-ignore - override the ttl overload used by resolve4()
		dns.resolve4 = ((host: string, _opts: unknown, cb: Function) => {
			resolves++;
			cb(null, [{ address: '127.0.0.1', ttl: 60 }]);
		}) as typeof dns.resolve4;

		try {
			const fetch = createFetch();
			const url = `http://dns-cache-test.example:${server.port}/`;
			await (await fetch(url, { retry: { retries: 0 } })).text();
			const afterFirst = resolves;
			await (await fetch(url, { retry: { retries: 0 } })).text();
			assert.ok(afterFirst >= 1, 'first request should resolve via resolve4');
			assert.equal(resolves, afterFirst, 'second request should hit the DNS cache');
		} finally {
			dns.resolve4 = original;
			await server.close();
		}
	});
});
