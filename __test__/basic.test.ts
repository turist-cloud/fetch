import toBuffer from 'raw-body';
import { Server, createServer, IncomingMessage, ServerResponse } from 'http';
import createFetch from '../src';

function getAddr(server: Server) {
	const addr = server.address();

	if (!addr || typeof addr === 'string') {
		throw new Error('Unable to extract the address');
	}

	const { address, family, port } = addr;

	return { address, family, port };
}

function listen(server: Server, ...args: any[]) {
	return new Promise((resolve, reject) => {
		args.push((err: Error) => {
			if (err) return reject(err);

			const { address, family, port } = getAddr(server);
			const host = 'IPv6' === family ? `[${address}]` : address;

			resolve(`http://${host}:${port}`);
		})

		server.listen(...args);
	})
}

const fetch = createFetch();

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
	await listen(server);

	const { port } = getAddr(server);
	const res = await fetch(`http://127.0.0.1:${port}`);
	const resBody = await res.text();
	server.close();

	expect(resBody).toBe('ha');
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

test('supports buffer request body', async () => {
	const server = createServer(async (req, res) => {
		const body = await toBuffer(req);

		expect(Buffer.isBuffer(body)).toBeTruthy();
		expect(body.toString()).toBe('foo');

		res.end(JSON.stringify({ body: body.toString() }));
	});
	await listen(server);

	const { port } = getAddr(server);
	const res = await fetch(`http://127.0.0.1:${port}`, {
		method: 'POST',
		body: Buffer.from('foo')
	});
	const body = await res.json();
	server.close();

	expect(body).toEqual({ body: 'foo' })
});
