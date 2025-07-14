import path from "path";
import fs from "fs/promises";
import { lock } from "proper-lockfile";
import { ACCURACY_RESULTS_DIR, LATEST_ACCURACY_RUN_NAME } from "../constants.js";
import {
    AccuracyResult,
    AccuracyResultStorage,
    AccuracyRunStatus,
    AccuracyRunStatuses,
    ModelResponse,
} from "./result-storage.js";

export class DiskBasedResultStorage implements AccuracyResultStorage {
    async getAccuracyResult(commitSHA: string, runId?: string): Promise<AccuracyResult | null> {
        const filePath = runId
            ? // If we have both commit and runId then we get the path for
              // specific file. Common case when saving prompt responses during an
              // accuracy run
              this.getAccuracyResultFilePath(commitSHA, runId)
            : // If we only have commit then we grab the latest successful run for the
              // commit. The latest run is a link to the last run that was
              // marked as successful.
              this.getAccuracyResultFilePath(commitSHA, LATEST_ACCURACY_RUN_NAME);

        try {
            const raw = await fs.readFile(filePath, "utf8");
            return JSON.parse(raw) as AccuracyResult;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return null;
            }
            throw error;
        }
    }

    async updateRunStatus(commitSHA: string, runId: string, status: AccuracyRunStatuses): Promise<void> {
        const resultFilePath = this.getAccuracyResultFilePath(commitSHA, runId);
        const release = await lock(resultFilePath, { retries: 10 });
        try {
            const accuracyResult = await this.getAccuracyResult(commitSHA, runId);
            if (!accuracyResult) {
                throw new Error("Results not found!");
            }

            await fs.writeFile(
                resultFilePath,
                JSON.stringify(
                    {
                        ...accuracyResult,
                        runStatus: status,
                    },
                    null,
                    2
                ),
                { encoding: "utf8" }
            );
        } catch (error) {
            console.warn(
                `Could not update run status to ${status} for commit - ${commitSHA}, runId - ${runId}.`,
                error
            );
            throw error;
        } finally {
            await release();
        }

        // This bit is important to mark the current run as the latest run for a
        // commit so that we can use that during baseline comparison.
        if (status === AccuracyRunStatus.Done) {
            await this.atomicUpdateLink(
                this.getAccuracyResultFilePath(commitSHA, runId),
                this.getLatestResultFilePath(commitSHA)
            );
        }
    }

    async saveModelResponseForPrompt(
        commitSHA: string,
        runId: string,
        prompt: string,
        modelResponse: ModelResponse
    ): Promise<void> {
        const resultFilePath = this.getAccuracyResultFilePath(commitSHA, runId);
        const { fileCreatedWithInitialData } = await this.ensureAccuracyResultFile(
            resultFilePath,
            JSON.stringify(
                {
                    runId,
                    runStatus: AccuracyRunStatus.InProgress,
                    createdOn: Date.now(),
                    commitSHA,
                    promptResults: [
                        {
                            prompt,
                            modelResponses: [modelResponse],
                        },
                    ],
                },
                null,
                2
            )
        );

        if (fileCreatedWithInitialData) {
            return;
        }

        const releaseLock = await lock(resultFilePath, { retries: 10 });
        try {
            const accuracyResult = await this.getAccuracyResult(commitSHA, runId);
            if (!accuracyResult) {
                throw new Error("Expected at-least initial accuracy result to be present");
            }

            const existingPromptIdx = accuracyResult.promptResults.findIndex((result) => result.prompt === prompt);
            const promptResult = accuracyResult.promptResults[existingPromptIdx];
            if (!promptResult) {
                return await fs.writeFile(
                    resultFilePath,
                    JSON.stringify(
                        {
                            ...accuracyResult,
                            promptResults: [
                                ...accuracyResult.promptResults,
                                {
                                    prompt,
                                    modelResponses: [modelResponse],
                                },
                            ],
                        },
                        null,
                        2
                    )
                );
            }

            accuracyResult.promptResults.splice(existingPromptIdx, 1, {
                prompt: promptResult.prompt,
                modelResponses: [...promptResult.modelResponses, modelResponse],
            });

            return await fs.writeFile(resultFilePath, JSON.stringify(accuracyResult, null, 2));
        } catch (error) {
            console.warn(`Could not save model response for commit - ${commitSHA}, runId - ${runId}.`, error);
            throw error;
        } finally {
            await releaseLock?.();
        }
    }

    close(): Promise<void> {
        return Promise.resolve();
    }

    private async ensureAccuracyResultFile(
        filePath: string,
        initialData: string
    ): Promise<{
        fileCreatedWithInitialData: boolean;
    }> {
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, initialData, { flag: "wx" });
            return {
                fileCreatedWithInitialData: true,
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") {
                return {
                    fileCreatedWithInitialData: false,
                };
            }
            throw error;
        }
    }

    private async atomicUpdateLink(filePath: string, linkPath: string) {
        for (let attempt = 0; attempt < 10; attempt++) {
            try {
                const tempLinkPath = `${linkPath}~${Date.now()}`;
                await fs.link(filePath, tempLinkPath);
                await fs.rename(tempLinkPath, linkPath);
                return;
            } catch (error) {
                if (attempt < 10) {
                    await this.waitFor(100 + Math.random() * 200);
                } else {
                    throw error;
                }
            }
        }
    }

    private getAccuracyResultFilePath(commitSHA: string, runId: string): string {
        return path.join(ACCURACY_RESULTS_DIR, commitSHA, `${runId}.json`);
    }

    private getLatestResultFilePath(commitSHA: string): string {
        return path.join(ACCURACY_RESULTS_DIR, commitSHA, `${LATEST_ACCURACY_RUN_NAME}.json`);
    }

    private waitFor(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
