import { isHarnessDebug } from "./shared.js";

/** Minimal stdout logger for a harness; prefixes messages with `[<label>]`. */
export class HarnessLogger {
    constructor(private readonly label: string) {}

    /** Always-visible message. */
    info(message: string): void {
        console.log(`[${this.label}] ${message}`);
    }

    /** Debug-gated (`AGENT_E2E_DEBUG`) message. */
    debug(message: string): void {
        if (isHarnessDebug()) {
            console.log(`[${this.label}] ${message}`);
        }
    }
}
