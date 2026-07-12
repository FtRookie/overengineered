/* eslint-disable no-undef */
// Dev-only relay. You only need it if your connection cannot pull real saves out of the database.
//
//   npm run dbrelay
//   -> .env: DB_BASEURL=http://localhost:1367/overengineered
//
// Roblox Studio makes its HTTP requests straight from the machine and cannot be given a proxy. On a link
// where the path to the database is throttled — small responses arrive, anything past a few KB crawls to a
// few hundred B/s and then dies — that makes production unreadable from Studio, and no change to the game
// code can help. This listens on localhost and forwards upstream THROUGH a proxy that does have a working
// path, so Studio talks plain HTTP to localhost and there is nothing left for a middlebox to strangle.
//
// It reads the REAL database and stores nothing. Kill it and the game goes straight back to production.
//
// Configure in .env:
//   RELAY_PROXY    proxy to tunnel through; empty = go direct
//   RELAY_TARGET   upstream origin, default https://ftrookie.com
//   RELAY_PORT     local port, default 1367

const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const TARGET = new URL(process.env.RELAY_TARGET ?? "https://ftrookie.com");
const PROXY = process.env.RELAY_PROXY ? new URL(process.env.RELAY_PROXY) : undefined;
const PORT = Number(process.env.RELAY_PORT ?? 1367);

const secure = TARGET.protocol === "https:";
const upstreamPort = Number(TARGET.port) || (secure ? 443 : 80);

// A trailing slash here would double-slash every path we forward.
const basePath = TARGET.pathname.endsWith("/") ? TARGET.pathname.slice(0, -1) : TARGET.pathname;

/** Raw TCP tunnel through the proxy. Node's fetch has no proxy support, and an HTTP proxy cannot carry TLS
 *  any other way: it has to hand us a socket and then stay out of the conversation. */
const tunnel = (callback) => {
	const connect = http.request({
		host: PROXY.hostname,
		port: Number(PROXY.port) || 80,
		method: "CONNECT",
		path: `${TARGET.hostname}:${upstreamPort}`,
		headers: { host: `${TARGET.hostname}:${upstreamPort}` },
	});

	connect.on("connect", (response, socket) => {
		if (response.statusCode !== 200) {
			callback(new Error(`proxy refused CONNECT with HTTP ${response.statusCode}`));
			return;
		}

		callback(undefined, socket);
	});
	connect.on("error", callback);
	connect.end();
};

const server = http.createServer((req, res) => {
	const started = Date.now();

	const fail = (err) => {
		console.error(`${req.method} ${req.url} -> FAILED after ${Date.now() - started}ms: ${err.message}`);
		if (res.headersSent) return res.destroy();

		res.writeHead(502, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: err.message, err_type: "HTTP" }));
	};

	const forward = (err, socket) => {
		if (err) return fail(err);

		const upstream = (secure ? https : http).request(
			{
				method: req.method,
				path: basePath + req.url,
				// Ours still says localhost:1367, and Cloudflare routes on Host.
				headers: { ...req.headers, host: TARGET.host },
				host: TARGET.hostname,
				port: upstreamPort,
				servername: TARGET.hostname,
				socket,
				agent: false,
			},
			(response) => {
				let bytes = 0;
				response.on("data", (chunk) => (bytes += chunk.length));
				response.on("end", () => {
					const took = Date.now() - started;
					console.log(`${req.method} ${req.url} -> ${response.statusCode}, ${bytes} bytes, ${took}ms`);
				});

				res.writeHead(response.statusCode, response.headers);
				response.pipe(res);
			},
		);

		upstream.on("error", fail);
		req.pipe(upstream);
	};

	if (PROXY) {
		tunnel(forward);
	} else {
		forward(undefined, undefined);
	}
});

server.listen(PORT, () => {
	const via = PROXY ? `via ${PROXY.origin}` : "DIRECT";
	console.log(`db relay: http://localhost:${PORT}  ->  ${TARGET.origin}  (${via})`);

	// Without a proxy this forwards over the very link that could not pull the data in the first place. It
	// runs, it just does nothing for you — and that is worse than not running, because it looks like a fix.
	if (!PROXY) {
		console.warn(
			"\n  ⚠  No RELAY_PROXY in .env, so this is a plain pass-through going out over your own\n" +
				"     connection — the one that could not reach the database. If that is why you started\n" +
				"     the relay, it will not help. Set RELAY_PROXY to a proxy that does have a path.\n",
		);
	}
});
