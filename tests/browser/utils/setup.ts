// Browser test setup - inject Node.js globals that are expected by MongoDB driver
import { Buffer } from "buffer";

// Make Buffer available globally
globalThis.Buffer = Buffer;
