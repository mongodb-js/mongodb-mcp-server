import type { Secret } from "mongodb-redact";
import { CompositeLogger, ConsoleLogger } from "./logging/index.js";

const secrets: Secret[] = [];
export const logger = new CompositeLogger(new ConsoleLogger(() => secrets));

export function addSecret(secret: string): void {
    secrets.push({ value: secret, kind: "password" });
}
