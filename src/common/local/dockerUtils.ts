import { promisify } from "util";
import { exec } from "child_process";
import { z } from "zod";
import { DockerPsSummary } from "../../tools/local/localTool.js";

export interface ClusterDetails {
    name: string;
    mongodbVersion: string;
    status: string;
    health: string;
    port: string;
    dbUser: string;
    isAuth: boolean; // Indicates if authentication is required
}

export async function getValidatedClusterDetails(clusterName: string): Promise<ClusterDetails> {
    const execAsync = promisify(exec);

    try {
        const { stdout } = await execAsync(`docker inspect ${clusterName}`);
        const containerDetails = JSON.parse(stdout) as DockerPsSummary[];

        if (!Array.isArray(containerDetails) || containerDetails.length === 0) {
            throw new Error(`No details found for cluster "${clusterName}".`);
        }

        const DockerInspectSchema = z.object({
            Config: z.object({
                Env: z.array(z.string()).optional(),
                Image: z.string(),
            }),
            NetworkSettings: z.object({
                Ports: z.record(
                    z.string(),
                    z
                        .array(
                            z
                                .object({
                                    HostPort: z.string(),
                                })
                                .optional()
                        )
                        .optional()
                ),
            }),
            State: z.object({
                Health: z
                    .object({
                        Status: z.string(),
                    })
                    .optional(),
                Status: z.string(),
            }),
            Name: z.string(),
        });

        const validatedDetails = DockerInspectSchema.parse(containerDetails[0]);

        const port = validatedDetails.NetworkSettings.Ports["27017/tcp"]?.[0]?.HostPort || "Unknown";

        const envVars = validatedDetails.Config.Env || [];
        const username = envVars.find((env) => env.startsWith("MONGODB_INITDB_ROOT_USERNAME="))?.split("=")[1];

        const isAuth = !!username; // Determine if authentication is required

        const mongodbVersionMatch = validatedDetails.Config.Image.match(/mongodb\/mongodb-atlas-local:(.+)/);
        const mongodbVersion = mongodbVersionMatch ? mongodbVersionMatch[1] : "Unknown";

        const status = validatedDetails.State.Status || "Unknown";
        const health = validatedDetails.State.Health?.Status || "Unknown";

        return {
            name: validatedDetails.Name.replace("/", ""),
            mongodbVersion,
            status,
            health,
            port,
            dbUser: username || "No user found",
            isAuth,
        };
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to inspect cluster "${clusterName}": ${error.message}`);
        } else {
            throw new Error(`An unexpected error occurred while inspecting cluster "${clusterName}".`);
        }
    }
}
