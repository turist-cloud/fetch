import { Server, createServer, IncomingMessage, ServerResponse } from 'http';
import createFetch from '../src';
import { FetchOptions } from '../src/types';
import { getAddr, listen, time } from './util';

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

test('resolves on >MAX_RETRIES', async () => {
	const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
		res.writeHead(500);
		res.end();
	});
	servers.push(server);

	return new Promise<void>((resolve, reject) => {
		server.listen(async () => {
			const { port } = getAddr(server);
			const res = await fetch(`http://127.0.0.1:${port}`);

			expect(res.status).toBe(500);

			return resolve();
		});
		server.on('error', reject);
	});
});

test('accepts a custom onRetry option', async () => {
	const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
		res.writeHead(500);
		res.end();
	});
	servers.push(server);

	return new Promise<void>((resolve, reject) => {
		const opts = {
			onRetry: jest.fn()
		}

		server.listen(async () => {
			const { port } = getAddr(server);
			const res = await fetch(`http://127.0.0.1:${port}`, opts);

			expect(opts.onRetry).toHaveBeenCalledTimes(3)
			expect(opts.onRetry.mock.calls[0][0]).toBeInstanceOf(Error);
			expect(opts.onRetry.mock.calls[0][1]).toBeTruthy();
			expect(res.status).toBe(500);

			return resolve();
		});
		server.on('error', reject);
	});
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

test('handles Retry-After', async () => {
	const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
		res.writeHead(429, { 'Retry-After': 1 });
		res.end();
	});
	servers.push(server);

	return new Promise<void>((resolve, reject) => {
		const opts = {
			onRetry: jest.fn(),
			retry: {
				retries: 1
			}
		}

		server.listen(async () => {
			const { port } = getAddr(server);

			const startTime = time();
			const res = await fetch(`http://127.0.0.1:${port}`, opts);
			const endTime = time();

			expect(opts.onRetry).toHaveBeenCalledTimes(1)
			expect(opts.onRetry.mock.calls[0][0]).toBeInstanceOf(Error);
			expect(opts.onRetry.mock.calls[0][1]).toBeTruthy();
			expect(res.status).toBe(429);
			expect(endTime - startTime).toBeCloseTo(1000, -3);

			return resolve();
		});
		server.on('error', reject);
	});
});
