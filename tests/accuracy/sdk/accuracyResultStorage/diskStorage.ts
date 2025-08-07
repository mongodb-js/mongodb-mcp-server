import path from "path";
import fs from "fs/promises";
import { lock } from "proper-lockfile";
import { ACCURACY_RESULTS_DIR, LATEST_ACCURACY_RUN_NAME } from "../constants.js";
import {
    AccuracyResult,
    AccuracyResultStorage,
    AccuracyRunStatus,
    AccuracyRunStatuses,
    ExpectedToolCall,
    ModelResponse,
} from "./resultStorage.js";

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

        return this.withFileLock<AccuracyResult | null>(filePath, () => this.getAccuracyResultWithoutLock(filePath));
    }

    async updateRunStatus(commitSHA: string, runId: string, status: AccuracyRunStatuses): Promise<void> {
        const resultFilePath = this.getAccuracyResultFilePath(commitSHA, runId);
        await this.withFileLock(resultFilePath, async () => {
            const accuracyResult = await this.getAccuracyResultWithoutLock(resultFilePath);
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
        });

        // This bit is important to mark the current run as the latest run for a
        // commit so that we can use that during baseline comparison.
        if (status === AccuracyRunStatus.Done) {
            const latestResultFilePath = this.getLatestResultFilePath(commitSHA);
            await this.ensureFileWithInitialData(latestResultFilePath, JSON.stringify({}));
            await this.withFileLock(latestResultFilePath, async () => {
                await fs.unlink(latestResultFilePath);
                await fs.link(resultFilePath, latestResultFilePath);
            });
        }
    }

    async saveModelResponseForPrompt({
        commitSHA,
        runId,
        prompt,
        expectedToolCalls,
        modelResponse,
    }: {
        commitSHA: string;
        runId: string;
        prompt: string;
        expectedToolCalls: ExpectedToolCall[];
        modelResponse: ModelResponse;
    }): Promise<void> {
        const initialData: AccuracyResult = {
            runId,
            runStatus: AccuracyRunStatus.InProgress,
            createdOn: Date.now(),
            commitSHA,
            promptResults: [
                {
                    prompt,
                    expectedToolCalls,
                    modelResponses: [modelResponse],
                },
            ],
        };
        const resultFilePath = this.getAccuracyResultFilePath(commitSHA, runId);
        const { fileCreatedWithInitialData } = await this.ensureFileWithInitialData(
            resultFilePath,
            JSON.stringify(initialData, null, 2)
        );

        if (fileCreatedWithInitialData) {
            return;
        }

        await this.withFileLock(resultFilePath, async () => {
            let accuracyResult = await this.getAccuracyResultWithoutLock(resultFilePath);
            if (!accuracyResult) {
                throw new Error("Expected at-least initial accuracy result to be present");
            }

            const existingPromptIdx = accuracyResult.promptResults.findIndex((result) => result.prompt === prompt);
            const promptResult = accuracyResult.promptResults[existingPromptIdx];
            if (promptResult) {
                accuracyResult.promptResults.splice(existingPromptIdx, 1, {
                    prompt: promptResult.prompt,
                    expectedToolCalls: promptResult.expectedToolCalls,
                    modelResponses: [...promptResult.modelResponses, modelResponse],
                });
            } else {
                accuracyResult = {
                    ...accuracyResult,
                    promptResults: [
                        ...accuracyResult.promptResults,
                        {
                            prompt,
                            expectedToolCalls,
                            modelResponses: [modelResponse],
                        },
                    ],
                };
            }

            await fs.writeFile(resultFilePath, JSON.stringify(accuracyResult, null, 2));
        });
    }

    close(): Promise<void> {
        return Promise.resolve();
    }

    private async getAccuracyResultWithoutLock(filePath: string): Promise<AccuracyResult | null> {
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

    private async ensureFileWithInitialData(
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

    private async withFileLock<R>(filePath: string, callback: () => Promise<R>): Promise<R> {
        let releaseLock: (() => Promise<void>) | undefined;
        try {
            releaseLock = await lock(filePath, { retries: 10 });
            return await callback();
        } catch (error) {
            console.warn(`Could not acquire lock for file - ${filePath}.`, error);
            throw error;
        } finally {
            await releaseLock?.();
        }
    }

    private getAccuracyResultFilePath(commitSHA: string, runId: string): string {
        return path.join(ACCURACY_RESULTS_DIR, commitSHA, `${runId}.json`);
    }

    private getLatestResultFilePath(commitSHA: string): string {
        return path.join(ACCURACY_RESULTS_DIR, commitSHA, `${LATEST_ACCURACY_RUN_NAME}.json`);
    }
}
