import { Server } from 'http';

export function getAddr(server: Server) {
	const addr = server.address();

	if (!addr || typeof addr === 'string') {
		throw new Error('Unable to extract the address');
	}

	const { address, family, port } = addr;

	return { address, family, port };
}

export function listen(server: Server, ...args: any[]) {
	return new Promise((resolve, reject) => {
		args.push((err: Error) => {
			if (err) return reject(err);

			const { address, family, port } = getAddr(server);
			const host = 'IPv6' === family ? `[${address}]` : address;

			resolve(`http://${host}:${port}`);
		});

		server.listen(...args);
	});
}

export function time() {
	const [seconds, nanos] = process.hrtime();
	return seconds * 1000 + nanos / 1000000;
}
