import toBuffer from 'raw-body';
import { Server, createServer, IncomingMessage, ServerResponse } from 'http';
import { FetchOptions } from '../src/types';
import createFetch from '../src';
import { getAddr, listen } from './util';

const fetch = createFetch();
let servers: Server[] = [];

afterEach(() => {
	while (servers.length) {
		const server = servers.pop();

		if (!server) {
			continue;
		}

		server.close();
	}
});

test('works with https', async () => {
	const res = await fetch('https://vercel.com');

	expect(res.url).toBe('https://vercel.com');
	expect(res.headers.get('Server')).toBe('Vercel');
});

/**
 * We know that http://vercel.com redirects to https so we can use it
 * as a test to make sure that we switch the agent when the it
 * happens
 */
test('switches agents on redirect', async () => {
	const res = await fetch('http://vercel.com');

	expect(res.url).toBe('https://vercel.com/');
});

test('redirect sets res.url correctly to a fqhn', async () => {
	const server = createServer(async (req, res) => {
		const host = req.headers['host'];
		if (!host) {
			throw new Error('Host missing');
		}

		// @ts-ignore
		const url = new URL(`http://${host}`);
		url.hostname = 'localhost';

		if (host.startsWith('localhost')) {
			res.writeHead(200);
			res.end();
		} else {
			res.writeHead(301, {
				Location: url.href
			});
			res.end();
		}
	});
	servers.push(server);

	await listen(server);

	const { port } = getAddr(server);
	const res = await fetch(`http://127.0.0.1:${port}`);
	expect(res.url).toBe(`http://localhost:${port}/`);
});

test('redirect sets res.url correctly when location is relative', async () => {
	const server = createServer(async (req, res) => {
		const host = req.headers['host'];
		if (!host) {
			throw new Error('Host missing');
		}

		if (!req.url) {
			throw new Error('Now URL');
		}

		if (req.url.includes('/root')) {
			expect(host).toEqual(expect.stringContaining('localhost'));
			res.writeHead(200);
			res.end();
		} else {
			expect(host).toEqual(expect.stringContaining('localhost'));
			res.writeHead(301, {
				Location: '/root'
			});
			res.end();
		}
	});
	servers.push(server);

	await listen(server);

	const { port } = getAddr(server);
	const res = await fetch(`http://localhost:${port}`);
	expect(res.url).toBe(`http://localhost:${port}/root`);
});

test('follows multiple redirects', async () => {
	let redirectCount = 0;
	const server = createServer(async (req, res) => {
		const host = req.headers['host'];
		if (!host) {
			throw new Error('Host missing');
		}

		if (!req.url) {
			throw new Error('Now URL');
		}

		if (req.url.includes('/root') && redirectCount === 2) {
			res.writeHead(200);
			res.end();
		} else {
			redirectCount++;

			res.writeHead(307, {
				Location: '/root'
			});
			res.end();
		}
	});
	servers.push(server);

	await listen(server);

	const { port } = getAddr(server);
	const res = await fetch(`http://127.0.0.1:${port}`);
	expect(res.url).toBe(`http://127.0.0.1:${port}/root`);
	expect(redirectCount).toBe(2);
});

test('serializing arbitrary objects as JSON', async () => {
	const server = createServer(async (req, res) => {
		const body = await toBuffer(req);

		expect(Buffer.isBuffer(body)).toBeTruthy();
		expect(body.toString()).toBe('{"key":"value"}');

		res.end();
	});
	servers.push(server);

	await listen(server);

	const { port } = getAddr(server);
	await fetch(`http://127.0.0.1:${port}`, {
		method: 'POST',
		body: { key: 'value' }
	});
});

test('supports buffer request body', async () => {
	const server = createServer(async (req, res) => {
		const body = await toBuffer(req);

		expect(Buffer.isBuffer(body)).toBeTruthy();
		expect(body.toString()).toBe('foo');

		res.end(JSON.stringify({ body: body.toString() }));
	});
	servers.push(server);

	await listen(server);

	const { port } = getAddr(server);
	const res = await fetch(`http://127.0.0.1:${port}`, {
		method: 'POST',
		body: Buffer.from('foo')
	});
	const body = await res.json();

	expect(body).toEqual({ body: 'foo' })
});

test('does not modify original opts', async () => {
	const server = createServer(async (_req, res) => {
		res.writeHead(200);
		res.end();
	});
	servers.push(server);
	await listen(server);

	const opts = {
		method: 'GET'
	};
	const { port } = getAddr(server);
	await fetch(`http://127.0.0.1:${port}`, opts);

	expect(opts).toStrictEqual({ method: 'GET' });
});

test('does not follow redirect when manual mode is specified', async () => {
	const server = createServer(async (_req, res) => {
		res.writeHead(300, {
			Location: 'http://google.com'
		});
		res.end();
	});
	servers.push(server);

	await listen(server);

	const { port } = getAddr(server);
	const url = `http://127.0.0.1:${port}`;
	const res = await fetch(url, {
		redirect: 'manual'
	});

	expect(res.url).toBe(url);
});

test('rejects redirect', async () => {
	const server = createServer(async (_req, res) => {
		res.writeHead(300, {
			Location: 'http://google.com'
		});
		res.end();
	});
	servers.push(server);

	await listen(server);

	const { port } = getAddr(server);
	const url = `http://127.0.0.1:${port}`;
	const p = fetch(url, {
		redirect: 'error'
	});

	expect(p).rejects.toBeTruthy();
});

test('rejects invalid redirect options', async () => {
	expect.assertions(1);
	const p = fetch('http://google.com', {
		// @ts-ignore
		redirect: 'teleport'
	});
	expect(p).rejects.toBeTruthy();
});
