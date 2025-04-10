import { OauthDeviceCode, OAuthToken } from "./common/atlas/apiClient.js";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { AsyncEntry } from "@napi-rs/keyring";
import logger from "./logger.js";
import { mongoLogId } from "mongodb-log-writer";

interface Credentials {
    auth: {
        status: "not_auth" | "requested" | "issued";
        code?: OauthDeviceCode;
        token?: OAuthToken;
    };
    connectionString?: string;
}

export class State {
    private entry = new AsyncEntry("mongodb-mcp", "credentials");
    public credentials: Credentials = {
        auth: {
            status: "not_auth",
        },
    };
    public serviceProvider?: NodeDriverServiceProvider;

    public async persistCredentials(): Promise<void> {
        await this.entry.setPassword(JSON.stringify(this.credentials));
    }

    public async loadCredentials(): Promise<boolean> {
        try {
            const data = await this.entry.getPassword();
            if (data) {
                this.credentials = JSON.parse(data);
            }

            return true;
        } catch (err: unknown) {
            logger.error(mongoLogId(1_000_007), "state", `Failed to load state: ${err}`);
            return false;
        }
    }
}

const defaultState = new State();
export default defaultState;
