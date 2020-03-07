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

test('retries upon http 500', async () => {
	let i = 0;
	const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
		if (i++ < 2) {
			res.writeHead(500);
			res.end();
		} else {
			res.end('ha');
		}
	});
	servers.push(server);

	await listen(server);

	const { port } = getAddr(server);
	const res = await fetch(`http://127.0.0.1:${port}`);
	const resBody = await res.text();

	expect(resBody).toBe('ha');
});

test('both onRetry() functions are called', async () => {
	const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
		res.writeHead(500);
		res.end();
	});
	servers.push(server);

	await listen(server);

	const onRetry1 = jest.fn((err: Error, opts: FetchOptions) => {
		expect(err).toBeInstanceOf(Error);
		expect(opts).toBeDefined();
	});
	const onRetry2 = jest.fn((err: Error) => {
		expect(err).toBeInstanceOf(Error);
	});

	const { port } = getAddr(server);
	const res = await fetch(`http://127.0.0.1:${port}`, {
		onRetry: onRetry1,
		retry: {
			retries: 1,
			onRetry: onRetry2
		}
	});

	expect(res.status).toBe(500);
	expect(onRetry1).toHaveBeenCalled();
	expect(onRetry2).toHaveBeenCalled();
});

test('works with https', async () => {
	const res = await fetch('https://zeit.co');

	expect(res.headers.get('Server')).toBe('now');
});

/**
 * We know that http://zeit.co redirects to https so we can use it
 * as a test to make sure that we switch the agent when the it
 * happens
 */
test('switches agents on redirect', async () => {
	const res = await fetch('http://zeit.co');

	expect(res.url).toBe('https://zeit.co/');
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
