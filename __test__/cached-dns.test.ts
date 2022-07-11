import { Server, createServer, IncomingMessage, ServerResponse } from 'http';
import createFetch from '../src';
import { getAddr, listen } from './util';
import { FetchOptions } from '../src/types';

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

/**
 * Using `localtest.me` to use DNS to resolve to localhost
 * http://readme.localtest.me/
 */
test('works with localtest.me', async () => {
	const server = createServer((_req: IncomingMessage, res) => {
		res.end('ha');
	});
	servers.push(server);

	await listen(server);
	const { port } = getAddr(server);
	const res = await fetch(`http://localtest.me:${port}`);

	expect(await res.text()).toBe('ha');
})

test('works with absolute redirects', async () => {
	let portA: number;
	let portB: number;

	const serverA = createServer((_req: IncomingMessage, res: ServerResponse) => {
		res.setHeader('Location', `http://localtest.me:${portB}`);
		res.statusCode = 302;
		res.end();
	});
	const serverB = createServer((req, res) => {
		// ensure the Host header is properly re-written upon redirect
		res.end(req.headers.host);
	});
	servers.push(serverA);
	servers.push(serverB);

	await listen(serverA);
	await listen(serverB);
	({ port: portA } = getAddr(serverA));
	({ port: portB } = getAddr(serverB));

	const res = await fetch(`http://localtest.me:${portA}`);
	expect(res.status).toBe(200);
	expect(await res.text()).toBe(`localtest.me:${portB}`);
})

test('works with relative redirects', async () => {
	let count = 0;

	const server = createServer((req, res) => {
		if (count === 0) {
			res.setHeader('Location', `/foo`);
			res.statusCode = 302;
			res.end();
		} else {
			res.end(req.url);
		}
		count++;
	});
	servers.push(server);

	await listen(server);
	const { port } = getAddr(server);
	const res = await fetch(`http://localtest.me:${port}`);

	expect(count).toBe(2);
	expect(res.status).toBe(200);
	expect(await res.text()).toBe(`/foo`);
})

test('works with `headers` as an Object', async () => {
	const server = createServer((req, res) => {
		res.end(req.headers['x-zeit']);
	});
	servers.push(server);

	await listen(server);
	const { port } = getAddr(server);

	const res = await fetch(`http://localtest.me:${port}`, {
		headers: {
			'X-Zeit': 'geist'
		}
	});

	expect(await res.text()).toBe('geist');
})

test('works with `onRedirect` option to customize opts', async () => {
	let count = 0;

	const server = createServer((req, res) => {
		if (count === 0) {
			res.setHeader('Location', `/foo`);
			res.statusCode = 302;
			res.end();
		} else {
			res.end(req.url);
		}
		count++;
	});
	servers.push(server);

	await listen(server);

	const { port } = getAddr(server);
	let resB: Response | null = null;
	let optsB: FetchOptions | null = null;
	const onRedirect = jest.fn((res: Response, opts: FetchOptions) => {
		opts.compress = true;

		resB = res;
		optsB = opts;
	});
	const options = { onRedirect };

	await fetch(`http://localtest.me:${port}`, options);

	expect(onRedirect).toHaveBeenCalledTimes(1);
	// @ts-ignore
	expect(resB.status).toEqual(302);
	// @ts-ignore
	expect(optsB.headers).toBeDefined();
	// @ts-ignore
	expect(optsB.compress).toBe(true);
})
