import { mongoLogId } from "mongodb-log-writer";

export const LogId = {
    systemCaWarning: mongoLogId(1_014_001),
    tokenFetch: mongoLogId(1_014_002),
    tokenAcquired: mongoLogId(1_014_003),
    tokenFetchError: mongoLogId(1_014_004),
    stdioTransportError: mongoLogId(1_014_005),
    shutdown: mongoLogId(1_014_006),
    httpSendError: mongoLogId(1_014_007),
    sessionInfo: mongoLogId(1_014_008),
    messageForwarded: mongoLogId(1_014_009),
    tokenReused: mongoLogId(1_014_010),
    configError: mongoLogId(1_014_011),
} as const;
