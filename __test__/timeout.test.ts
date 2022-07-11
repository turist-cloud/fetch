import { Server, createServer, IncomingMessage, ServerResponse } from "http";
import { getAddr, listen } from "./util";
import createFetch from "../src";

const fetch = createFetch({ timeout: 2000 });
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

test("Times out after the specified time", async () => {
	const server = createServer(
		(_req: IncomingMessage, _res: ServerResponse) => {
			// hang
		}
	);
	servers.push(server);
	await listen(server);

	const { port } = getAddr(server);

	await expect(
		fetch(`http://127.0.0.1:${port}`, { retry: { retries: 0 } })
	).rejects.toThrow(/Socket timeout/);
});
