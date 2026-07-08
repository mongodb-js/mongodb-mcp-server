import type { Secret } from "mongodb-redact";
import { CompositeLogger, ConsoleLogger } from "./logging/index.js";

const secrets: Secret[] = [];
let accessTokenSecret: Secret | null = null;

export const logger = new CompositeLogger(
    new ConsoleLogger(() => (accessTokenSecret ? [...secrets, accessTokenSecret] : [...secrets]))
);

export function addSecret(secret: string): void {
    secrets.push({ value: secret, kind: "password" });
}

export function setAccessToken(token: string): void {
    accessTokenSecret = { value: token, kind: "password" };
}
