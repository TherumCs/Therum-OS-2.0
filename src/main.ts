// The entrypoint for process supervisors (PM2, systemd).
//
// server.ts only boots when argv[1] points at itself, which is false whenever
// something wraps the process — and a wrapper is exactly what a supervisor is.
// This file has no condition: importing it starts the server. Tests import
// buildServer from server.js and are unaffected.
import { main } from './server.js';

void main();
