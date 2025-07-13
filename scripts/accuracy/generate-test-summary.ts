import { readFile, writeFile } from "fs/promises";
import { getAccuracyResultStorage } from "../../tests/accuracy/sdk/accuracy-result-storage/get-accuracy-result-storage.js";
import {
    AccuracyResult,
    AccuracyRunStatuses,
    ExpectedToolCall,
    LLMToolCall,
    ModelResponse,
} from "../../tests/accuracy/sdk/accuracy-result-storage/result-storage.js";
import { getCommitSHA } from "../../tests/accuracy/sdk/git-info.js";
import { HTML_TESTS_SUMMARY_FILE, HTML_TESTS_SUMMARY_TEMPLATE } from "../../tests/accuracy/sdk/constants.js";

type ComparableAccuracyResult = Omit<AccuracyResult, "promptResults"> & {
    promptAndModelResponses: PromptAndModelResponse[];
};

interface PromptAndModelResponse extends ModelResponse {
    prompt: string;
    baselineToolAccuracy?: number;
}

interface BaselineRunInfo {
    commitSHA: string;
    accuracyRunId: string;
    accuracyRunStatus: AccuracyRunStatuses;
    createdOn: string;
}

function populateTemplate(template: string, data: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => data[key] ?? "");
}

function formatRunStatus(status: AccuracyRunStatuses) {
    let statusClass = "chip run-status";
    if (status === "done") {
        statusClass += " perfect";
    } else if (status === "in-progress") {
        statusClass += " poor";
    } else if (status === "failed") {
        statusClass += " poor";
    }
    return `<span class="${statusClass}">${status}</span>`;
}

function formatAccuracy(accuracy: number): string {
    return (accuracy * 100).toFixed(1) + "%";
}

function getAccuracyClass(accuracy: number): string {
    if (accuracy === 1) return "chip perfect";
    if (accuracy >= 0.75) return "chip good";
    return "chip poor";
}

function formatToolCallsWithTooltip(toolCalls: ExpectedToolCall[] | LLMToolCall[]): string {
    return toolCalls
        .map((call) => {
            const params = JSON.stringify(call.parameters, null, 2);
            return `<span class="tool-call" title="${params.replace(/"/g, "&quot;")}">${call.toolName}</span>`;
        })
        .join(", ");
}

function formatTokenUsage(tokensUsage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}): string {
    const total = tokensUsage.totalTokens || "-";
    const prompt = tokensUsage.promptTokens || "-";
    const completion = tokensUsage.completionTokens || "-";

    const tooltip = `Prompt: ${prompt}\nCompletion: ${completion}\nTotal: ${total}`;
    return `<span class="tokens-usage" title="${tooltip}">${total}</span>`;
}

function formatMessages(messages: Array<Record<string, unknown>>): string {
    return messages.map((msg) => JSON.stringify(msg, null, 2)).join("\n\n");
}

function formatCurrentAccuracy(response: PromptAndModelResponse): string {
    const currentAccuracyText = formatAccuracy(response.toolCallingAccuracy);
    const comparisonClass = getAccuracyClass(response.toolCallingAccuracy);
    let comparisonIcon = "";

    if (typeof response.baselineToolAccuracy === "number") {
        if (response.toolCallingAccuracy > response.baselineToolAccuracy) {
            comparisonIcon = " ↗";
        } else if (response.toolCallingAccuracy < response.baselineToolAccuracy) {
            comparisonIcon = " ↘";
        } else {
            comparisonIcon = " →";
        }
    }

    return `<span class="${comparisonClass}">${currentAccuracyText}${comparisonIcon}</span>`;
}

function formatBaselineAccuracy(response: PromptAndModelResponse): string {
    if (response.baselineToolAccuracy === null || response.baselineToolAccuracy === undefined) {
        return '<span class="accuracy-comparison">N/A</span>';
    }
    return `<span class="accuracy-comparison">${formatAccuracy(response.baselineToolAccuracy)}</span>`;
}

function getTestSummary(comparableResult: ComparableAccuracyResult) {
    const responses = comparableResult.promptAndModelResponses;
    return {
        totalPrompts: new Set(responses.map((r) => r.prompt)).size,
        totalModels: new Set(responses.map((r) => `${r.provider} ${r.requestedModel}`)).size,
        testsWithZeroAccuracy: responses.filter((r) => r.toolCallingAccuracy === 0),
        testsWith75Accuracy: responses.filter((r) => r.toolCallingAccuracy === 0.75),
        testsWith100Accuracy: responses.filter((r) => r.toolCallingAccuracy === 100),
        averageAccuracy:
            responses.length > 0 ? responses.reduce((sum, r) => sum + r.toolCallingAccuracy, 0) / responses.length : 0,
        evalsImproved: responses.filter(
            (r) => typeof r.baselineToolAccuracy === "number" && r.toolCallingAccuracy > r.baselineToolAccuracy
        ).length,
        evalsRegressed: responses.filter(
            (r) => typeof r.baselineToolAccuracy === "number" && r.toolCallingAccuracy < r.baselineToolAccuracy
        ).length,
        reportGeneratedOn: new Date().toLocaleString(),
        resultCreatedOn: new Date(comparableResult.createdOn).toLocaleString(),
    };
}

async function generateHtmlReport(
    comparableResult: ComparableAccuracyResult,
    testSummary: ReturnType<typeof getTestSummary>,
    baselineInfo: BaselineRunInfo | null
): Promise<string> {
    const responses = comparableResult.promptAndModelResponses;
    const tableRows = responses
        .map(
            (response, index) => `
            <tr class="test-row" onclick="toggleDetails(${index})">
                <td class="prompt-cell">
                    <span class="expand-indicator" id="indicator-${index}">▶</span>
                    ${response.prompt}
                </td>
                <td class="model-cell">${response.provider} - ${response.requestedModel}</td>
                <td class="tool-calls-cell">${formatToolCallsWithTooltip(response.expectedToolCalls)}</td>
                <td class="tool-calls-cell">${formatToolCallsWithTooltip(response.llmToolCalls)}</td>
                <td class="accuracy-cell">${formatCurrentAccuracy(response)}</td>
                <td class="baseline-accuracy-cell">${formatBaselineAccuracy(response)}</td>
                <td class="response-time-cell">${response.llmResponseTime.toFixed(2)}</td>
                <td class="tokens-cell">${formatTokenUsage(response.tokensUsed || {})}</td>
            </tr>
            <tr class="details-row" id="details-${index}">
                <td colspan="8">
                    <div class="details-content">
                        <div class="conversation-section">
                            <h4>🤖 LLM Response</h4>
                            <div class="conversation-content">${response.text || "N/A"}</div>
                        </div>
                        <div class="conversation-section">
                            <h4>💬 Conversation Messages</h4>
                            <div class="conversation-content">${formatMessages(response.messages || [])}</div>
                        </div>
                    </div>
                </td>
            </tr>
        `
        )
        .join("");

    const template = await readFile(HTML_TESTS_SUMMARY_TEMPLATE, "utf8");
    return populateTemplate(template, {
        commitSHA: comparableResult.commitSHA,
        accuracyRunId: comparableResult.runId,
        accuracyRunStatus: formatRunStatus(comparableResult.runStatus),
        reportGeneratedOn: testSummary.reportGeneratedOn,
        createdOn: testSummary.resultCreatedOn,
        totalTests: String(testSummary.totalPrompts),
        modelsCount: String(testSummary.totalModels),
        testsWithZeroAccuracy: String(testSummary.testsWithZeroAccuracy.length),
        averageAccuracy: formatAccuracy(testSummary.averageAccuracy),
        baselineCommitSHA: baselineInfo?.commitSHA || "-",
        baselineAccuracyRunId: baselineInfo?.accuracyRunId || "-",
        baselineAccuracyRunStatus: baselineInfo?.accuracyRunStatus
            ? formatRunStatus(baselineInfo?.accuracyRunStatus)
            : "-",
        baselineCreatedOn: baselineInfo?.createdOn || "-",
        evalsImproved: baselineInfo ? String(testSummary.evalsImproved) : "-",
        evalsRegressed: baselineInfo ? String(testSummary.evalsRegressed) : "-",
        tableRows,
    });
}

async function generateTestSummary() {
    const storage = getAccuracyResultStorage();
    try {
        const baselineCommit = process.env.MDB_ACCURACY_BASELINE_COMMIT;
        const accuracyRunCommit = await getCommitSHA();
        const accuracyRunId = process.env.MDB_ACCURACY_RUN_ID;

        if (!accuracyRunCommit) {
            throw new Error("Cannot generate summary without accuracyRunCommit");
        }

        const accuracyRunResult = await storage.getAccuracyResult(accuracyRunCommit, accuracyRunId);
        if (!accuracyRunResult) {
            throw new Error(
                `No accuracy run result found for commitSHA - ${accuracyRunCommit}, runId - ${accuracyRunId}`
            );
        }

        const baselineAccuracyRunResult = baselineCommit ? await storage.getAccuracyResult(baselineCommit) : null;
        const baselineInfo: BaselineRunInfo | null =
            baselineCommit && baselineAccuracyRunResult
                ? {
                      commitSHA: baselineCommit,
                      accuracyRunId: baselineAccuracyRunResult.runId,
                      accuracyRunStatus: baselineAccuracyRunResult.runStatus,
                      createdOn: new Date(baselineAccuracyRunResult.createdOn).toLocaleString(),
                  }
                : null;

        const comparableAccuracyResult: ComparableAccuracyResult = {
            ...accuracyRunResult,
            promptAndModelResponses: accuracyRunResult.promptResults.flatMap<PromptAndModelResponse>(
                (currentPromptResult) => {
                    const baselinePromptResult = baselineAccuracyRunResult?.promptResults.find((baselineResult) => {
                        return baselineResult.prompt === currentPromptResult.prompt;
                    });

                    return currentPromptResult.modelResponses.map<PromptAndModelResponse>((currentModelResponse) => {
                        const baselineModelResponse = baselinePromptResult?.modelResponses.find(
                            (baselineModelResponse) => {
                                return (
                                    baselineModelResponse.provider === currentModelResponse.provider &&
                                    baselineModelResponse.requestedModel === currentModelResponse.requestedModel
                                );
                            }
                        );
                        return {
                            ...currentModelResponse,
                            prompt: currentPromptResult.prompt,
                            baselineToolAccuracy: baselineModelResponse?.toolCallingAccuracy,
                        };
                    });
                }
            ),
        };

        console.log(`\n📊 Generating test summary for accuracy run: ${accuracyRunId}\n`);
        const testSummary = getTestSummary(comparableAccuracyResult);
        const htmlReport = await generateHtmlReport(comparableAccuracyResult, testSummary, baselineInfo);

        await writeFile(HTML_TESTS_SUMMARY_FILE, htmlReport, "utf8");

        console.log(`✅ HTML report generated: ${HTML_TESTS_SUMMARY_FILE}`);

        console.log(`\n📈 Summary:`);
        console.log(`   Total prompts evaluated: ${testSummary.totalPrompts}`);
        console.log(`   Models tested: ${testSummary.totalModels}`);
        console.log(`   Evals with 0% accuracy: ${testSummary.testsWithZeroAccuracy.length}`);

        if (baselineCommit) {
            console.log(`   Baseline commit: ${baselineCommit}`);
            console.log(`   Evals improved vs baseline: ${testSummary.evalsImproved}`);
            console.log(`   Evals regressed vs baseline: ${testSummary.evalsRegressed}`);
        }
    } catch (error) {
        console.error("Error generating test summary:", error);
        process.exit(1);
    } finally {
        await storage.close();
    }
}

void generateTestSummary();
