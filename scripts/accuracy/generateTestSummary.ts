import path from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { getAccuracyResultStorage } from "../../tests/accuracy/sdk/accuracyResultStorage/getAccuracyResultStorage.js";
import {
    AccuracyResult,
    AccuracyRunStatuses,
    ExpectedToolCall,
    LLMToolCall,
    ModelResponse,
} from "../../tests/accuracy/sdk/accuracyResultStorage/resultStorage.js";
import { getCommitSHA } from "../../tests/accuracy/sdk/gitInfo.js";
import {
    HTML_TEST_SUMMARY_FILE,
    HTML_TESTS_SUMMARY_TEMPLATE,
    MARKDOWN_TEST_BRIEF_FILE,
} from "../../tests/accuracy/sdk/constants.js";

type ComparableAccuracyResult = Omit<AccuracyResult, "promptResults"> & {
    promptAndModelResponses: PromptAndModelResponse[];
};

interface PromptAndModelResponse extends ModelResponse {
    prompt: string;
    expectedToolCalls: ExpectedToolCall[];
    baselineToolAccuracy?: number;
}

interface BaselineRunInfo {
    commitSHA: string;
    accuracyRunId: string;
    accuracyRunStatus: AccuracyRunStatuses;
    createdOn: string;
}

interface TestSummary {
    totalPrompts: number;
    totalModels: number;
    responsesWithZeroAccuracy: ModelResponse[];
    responsesWith75Accuracy: ModelResponse[];
    responsesWith100Accuracy: ModelResponse[];
    averageAccuracy: number;
    responsesImproved: number;
    responsesRegressed: number;
    reportGeneratedOn: string;
    resultCreatedOn: string;
}

function populateTemplate(template: string, data: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => data[key] ?? "");
}

function formatRunStatus(status: AccuracyRunStatuses): string {
    const statusClasses = ["chip", "run-status"];
    if (status === "done") {
        statusClasses.push("perfect");
    } else if (status === "in-progress" || status === "failed") {
        statusClasses.push("poor");
    }
    return `<span class="${statusClasses.join(" ")}">${status}</span>`;
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

    const tooltip = [`Prompt: ${prompt}`, `Completion: ${completion}`, `Total: ${total}`].join("\n");
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

function getTestSummary(comparableResult: ComparableAccuracyResult): TestSummary {
    const responses = comparableResult.promptAndModelResponses;
    return {
        totalPrompts: new Set(responses.map((r) => r.prompt)).size,
        totalModels: new Set(responses.map((r) => `${r.provider} ${r.requestedModel}`)).size,
        responsesWithZeroAccuracy: responses.filter((r) => r.toolCallingAccuracy === 0),
        responsesWith75Accuracy: responses.filter((r) => r.toolCallingAccuracy === 0.75),
        responsesWith100Accuracy: responses.filter((r) => r.toolCallingAccuracy === 1),
        averageAccuracy:
            responses.length > 0 ? responses.reduce((sum, r) => sum + r.toolCallingAccuracy, 0) / responses.length : 0,
        responsesImproved: responses.filter(
            (r) => typeof r.baselineToolAccuracy === "number" && r.toolCallingAccuracy > r.baselineToolAccuracy
        ).length,
        responsesRegressed: responses.filter(
            (r) => typeof r.baselineToolAccuracy === "number" && r.toolCallingAccuracy < r.baselineToolAccuracy
        ).length,
        reportGeneratedOn: new Date().toLocaleString(),
        resultCreatedOn: new Date(comparableResult.createdOn).toLocaleString(),
    };
}

async function generateHtmlReport(
    comparableResult: ComparableAccuracyResult,
    testSummary: TestSummary,
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
        totalPrompts: String(testSummary.totalPrompts),
        totalModels: String(testSummary.totalModels),
        responsesWithZeroAccuracy: String(testSummary.responsesWithZeroAccuracy.length),
        averageAccuracy: formatAccuracy(testSummary.averageAccuracy),
        baselineCommitSHA: baselineInfo?.commitSHA || "-",
        baselineAccuracyRunId: baselineInfo?.accuracyRunId || "-",
        baselineAccuracyRunStatus: baselineInfo?.accuracyRunStatus
            ? formatRunStatus(baselineInfo?.accuracyRunStatus)
            : "-",
        baselineCreatedOn: baselineInfo?.createdOn || "-",
        responsesImproved: baselineInfo ? String(testSummary.responsesImproved) : "-",
        responsesRegressed: baselineInfo ? String(testSummary.responsesRegressed) : "-",
        tableRows,
    });
}

function generateMarkdownBrief(
    comparableResult: ComparableAccuracyResult,
    testSummary: TestSummary,
    baselineInfo: BaselineRunInfo | null
): string {
    const markdownTexts = [
        "# 📊 Accuracy Test Results",
        "## 📈 Summary",
        "| Metric | Value |",
        "|--------|-------|",
        `| **Commit SHA** | \`${comparableResult.commitSHA}\` |`,
        `| **Run ID** | \`${comparableResult.runId}\` |`,
        `| **Status** | ${comparableResult.runStatus} |`,
        `| **Total Prompts Evaluated** | ${testSummary.totalPrompts} |`,
        `| **Models Tested** | ${testSummary.totalModels} |`,
        `| **Average Accuracy** | ${formatAccuracy(testSummary.averageAccuracy)} |`,
        `| **Responses with 0% Accuracy** | ${testSummary.responsesWithZeroAccuracy.length} |`,
        `| **Responses with 75% Accuracy** | ${testSummary.responsesWith75Accuracy.length} |`,
        `| **Responses with 100% Accuracy** | ${testSummary.responsesWith100Accuracy.length} |`,
        "",
    ];

    if (baselineInfo) {
        markdownTexts.push(
            ...[
                "## 📊 Baseline Comparison",
                "| Metric | Value |",
                "|--------|-------|",
                `| **Baseline Commit** | \`${baselineInfo.commitSHA}\` |`,
                `| **Baseline Run ID** | \`${baselineInfo.accuracyRunId}\` |`,
                `| **Baseline Run Status** | \`${baselineInfo.accuracyRunStatus}\` |`,
                `| **Responses Improved** | ${testSummary.responsesImproved} |`,
                `| **Responses Regressed** | ${testSummary.responsesRegressed} |`,
                "",
            ]
        );
    }

    const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
    const githubRunUrl =
        GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
            ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
            : null;

    const reportLinkText = githubRunUrl
        ? `📎 **[Download Full HTML Report](${githubRunUrl})** - Look for the \`accuracy-test-summary\` artifact for detailed results.`
        : `📎 **Full HTML Report**: \`${HTML_TEST_SUMMARY_FILE}\``;

    markdownTexts.push(...["---", reportLinkText, "", `*Report generated on: ${testSummary.reportGeneratedOn}*`]);

    return markdownTexts.join("\n");
}

async function generateTestSummary(): Promise<void> {
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
                            expectedToolCalls: currentPromptResult.expectedToolCalls,
                            baselineToolAccuracy: baselineModelResponse?.toolCallingAccuracy,
                        };
                    });
                }
            ),
        };

        // Ensure that our writable path actually exist.
        await mkdir(path.dirname(HTML_TEST_SUMMARY_FILE), { recursive: true });

        console.log(`\n📊 Generating test summary for accuracy run: ${accuracyRunId}\n`);
        const testSummary = getTestSummary(comparableAccuracyResult);

        const htmlReport = await generateHtmlReport(comparableAccuracyResult, testSummary, baselineInfo);
        await writeFile(HTML_TEST_SUMMARY_FILE, htmlReport, "utf8");
        console.log(`✅ HTML report generated: ${HTML_TEST_SUMMARY_FILE}`);

        const markdownBrief = generateMarkdownBrief(comparableAccuracyResult, testSummary, baselineInfo);
        await writeFile(MARKDOWN_TEST_BRIEF_FILE, markdownBrief, "utf8");
        console.log(`✅ Markdown brief generated: ${MARKDOWN_TEST_BRIEF_FILE}`);

        console.log(`\n📈 Summary:`);
        console.log(`   Total prompts evaluated: ${testSummary.totalPrompts}`);
        console.log(`   Models tested: ${testSummary.totalModels}`);
        console.log(`   Responses with 0% accuracy: ${testSummary.responsesWithZeroAccuracy.length}`);

        if (baselineCommit) {
            console.log(`   Baseline commit: ${baselineCommit}`);
            console.log(`   Responses improved vs baseline: ${testSummary.responsesImproved}`);
            console.log(`   Responses regressed vs baseline: ${testSummary.responsesRegressed}`);
        }
    } catch (error) {
        console.error("Error generating test summary:", error);
        process.exit(1);
    } finally {
        await storage.close();
    }
}

void generateTestSummary();
