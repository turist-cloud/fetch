import { Server, createServer, IncomingMessage, ServerResponse } from 'http';
import createFetch from '../src';
import { getAddr } from './util';

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

test('retries upon 500', async () => {
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

	return new Promise((resolve, reject) => {
		server.listen(async () => {
			const { port } = getAddr(server);

			try {
				const res = await fetch(`http://127.0.0.1:${port}`);
				expect(await res.text()).toBe('ha');

				resolve();
			} catch (err) {
				reject(err);
			}
		});

		server.on('error', reject);
	});
});

test('resolves on >MAX_RETRIES', async () => {
	const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
		res.writeHead(500);
		res.end();
	});
	servers.push(server);

	return new Promise((resolve, reject) => {
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

	return new Promise((resolve, reject) => {
		const opts = {
			onRetry: jest.fn()
		}

		server.listen(async () => {
			const { port } = getAddr(server);
			const res = await fetch(`http://127.0.0.1:${port}`, opts);

			expect(opts.onRetry.mock.calls.length).toBe(3);
			expect(opts.onRetry.mock.calls[0][0]).toBeInstanceOf(Error);
			expect(opts.onRetry.mock.calls[0][1]).toEqual(opts);
			expect(res.status).toBe(500);

			return resolve();
		});
		server.on('error', reject);
	});
})
