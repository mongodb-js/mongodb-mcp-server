import { mongoLogId } from "mongodb-log-writer";

export const LogId = {
    systemCaWarning: mongoLogId(1_014_001),
    tokenFetch: mongoLogId(1_014_002),
    tokenAcquired: mongoLogId(1_014_003),
    tokenFetchError: mongoLogId(1_014_004),
    stdioTransportError: mongoLogId(1_014_005),
    shutdown: mongoLogId(1_014_006),
} as const;
