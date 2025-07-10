import { readFile, writeFile } from "fs/promises";
import { getAccuracySnapshotStorage } from "../tests/accuracy/sdk/accuracy-snapshot-storage/get-snapshot-storage.js";
import { HTML_TESTS_SUMMARY_FILE, HTML_TESTS_SUMMARY_TEMPLATE } from "../tests/accuracy/sdk/constants.js";
import type {
    AccuracySnapshotEntry,
    ExpectedToolCall,
    LLMToolCall,
} from "../tests/accuracy/sdk/accuracy-snapshot-storage/snapshot-storage.js";

interface BaselineComparison {
    baselineAccuracy?: number;
    comparisonResult?: "improved" | "regressed" | "same";
}

interface SnapshotEntryWithBaseline extends AccuracySnapshotEntry {
    baseline?: BaselineComparison;
}

function populateTemplate(template: string, data: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => data[key] ?? "");
}

function formatAccuracy(accuracy: number): string {
    return (accuracy * 100).toFixed(1) + "%";
}

function getAccuracyClass(accuracy: number): string {
    if (accuracy === 1) return "accuracy-perfect";
    if (accuracy >= 0.75) return "accuracy-good";
    return "accuracy-poor";
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
    const total = tokensUsage.totalTokens || 0;
    const prompt = tokensUsage.promptTokens || 0;
    const completion = tokensUsage.completionTokens || 0;

    const tooltip = `Prompt: ${prompt}\nCompletion: ${completion}\nTotal: ${total}`;
    return `<span class="tokens-usage" title="${tooltip}">${total}</span>`;
}

function formatMessages(messages: Array<Record<string, unknown>>): string {
    return messages.map((msg) => JSON.stringify(msg, null, 2)).join("\n\n");
}

function formatBaselineAccuracy(snapshot: SnapshotEntryWithBaseline): string {
    if (!snapshot.baseline || snapshot.baseline.baselineAccuracy === undefined) {
        return '<span class="accuracy-comparison">N/A</span>';
    }

    const baselineAccuracyText = formatAccuracy(snapshot.baseline.baselineAccuracy);
    let comparisonClass = "accuracy-comparison";
    let comparisonIcon = "";

    if (snapshot.baseline.comparisonResult) {
        switch (snapshot.baseline.comparisonResult) {
            case "improved":
                comparisonClass += " accuracy-improved";
                comparisonIcon = " ↗";
                break;
            case "regressed":
                comparisonClass += " accuracy-regressed";
                comparisonIcon = " ↘";
                break;
            case "same":
                comparisonClass += " accuracy-same";
                comparisonIcon = " →";
                break;
        }
    }

    return `<span class="${comparisonClass}">${baselineAccuracyText}${comparisonIcon}</span>`;
}

function compareSnapshotEntries(
    currentSnapshotEntries: AccuracySnapshotEntry[],
    baselineSnapshotEntries: AccuracySnapshotEntry[]
): SnapshotEntryWithBaseline[] {
    const baselineMap = new Map<string, AccuracySnapshotEntry>();
    baselineSnapshotEntries.forEach((entry) => {
        const key = `${entry.provider}|${entry.requestedModel}|${entry.prompt}`;
        baselineMap.set(key, entry);
    });

    return currentSnapshotEntries.map((entry) => {
        const key = `${entry.provider}|${entry.requestedModel}|${entry.prompt}`;
        const baselineEntry = baselineMap.get(key);

        if (!baselineEntry) {
            return entry;
        }

        let comparisonResult: "improved" | "regressed" | "same";
        if (entry.toolCallingAccuracy > baselineEntry.toolCallingAccuracy) {
            comparisonResult = "improved";
        } else if (entry.toolCallingAccuracy < baselineEntry.toolCallingAccuracy) {
            comparisonResult = "regressed";
        } else {
            comparisonResult = "same";
        }

        return {
            ...entry,
            baseline: {
                baselineAccuracy: baselineEntry.toolCallingAccuracy,
                comparisonResult,
            },
        };
    });
}

async function generateHtmlReport(
    snapshotEntries: SnapshotEntryWithBaseline[],
    accuracyRunId: string,
    baselineInfo?: {
        commitSHA: string;
        accuracyRunId: string;
        createdOn: string;
    }
): Promise<string> {
    const totalPrompts = snapshotEntries.length;
    const modelsCount = new Set(snapshotEntries.map((s) => `${s.provider} ${s.requestedModel}`)).size;
    const testsWithZeroAccuracy = snapshotEntries.filter((snapshotEntry) => snapshotEntry.toolCallingAccuracy === 0);

    const totalAccuracy = snapshotEntries.reduce((sum, entry) => sum + entry.toolCallingAccuracy, 0);
    const averageAccuracy = totalPrompts > 0 ? totalAccuracy / totalPrompts : 0;

    const evalsImproved = snapshotEntries.filter((s) => s.baseline?.comparisonResult === "improved").length;
    const evalsRegressed = snapshotEntries.filter((s) => s.baseline?.comparisonResult === "regressed").length;

    const firstSnapshotEntry = snapshotEntries[0];
    const runStatus = firstSnapshotEntry?.accuracyRunStatus || "unknown";
    const commitSHA = firstSnapshotEntry?.commitSHA || "unknown";
    const createdOn = firstSnapshotEntry?.createdOn
        ? new Date(firstSnapshotEntry.createdOn).toLocaleString()
        : "unknown";
    const reportGeneratedOn = new Date().toLocaleString();

    const tableRows = snapshotEntries
        .map(
            (snapshotEntry, index) => `
                <tr class="test-row" onclick="toggleDetails(${index})">
                    <td class="prompt-cell">
                        <span class="expand-indicator" id="indicator-${index}">▶</span>
                        ${snapshotEntry.prompt}
                    </td>
                    <td class="model-cell">${snapshotEntry.provider} - ${snapshotEntry.requestedModel}</td>
                    <td class="tool-calls-cell">${formatToolCallsWithTooltip(snapshotEntry.expectedToolCalls)}</td>
                    <td class="tool-calls-cell">${formatToolCallsWithTooltip(snapshotEntry.actualToolCalls)}</td>
                    <td class="accuracy-cell">
                        <span class="${getAccuracyClass(snapshotEntry.toolCallingAccuracy)}">
                            ${formatAccuracy(snapshotEntry.toolCallingAccuracy)}
                        </span>
                    </td>
                    <td class="baseline-accuracy-cell">${formatBaselineAccuracy(snapshotEntry)}</td>
                    <td class="response-time-cell">${snapshotEntry.llmResponseTime.toFixed(2)}</td>
                    <td class="tokens-cell">${formatTokenUsage(snapshotEntry.tokensUsage || {})}</td>
                </tr>
                <tr class="details-row" id="details-${index}">
                    <td colspan="8">
                        <div class="details-content">
                            <div class="conversation-section">
                                <h4>🤖 LLM Response</h4>
                                <div class="conversation-content">${snapshotEntry.text}</div>
                            </div>
                            <div class="conversation-section">
                                <h4>💬 Conversation Messages</h4>
                                <div class="conversation-content">${formatMessages(snapshotEntry.messages)}</div>
                            </div>
                        </div>
                    </td>
                </tr>
            `
        )
        .join("");

    const template = await readFile(HTML_TESTS_SUMMARY_TEMPLATE, "utf8");
    return populateTemplate(template, {
        accuracyRunId,
        runStatus,
        runStatusUpper: runStatus.toUpperCase(),
        commitSHA,
        reportGeneratedOn,
        createdOn,
        totalTests: String(totalPrompts),
        modelsCount: String(modelsCount),
        testsWithZeroAccuracy: String(testsWithZeroAccuracy.length),
        averageAccuracy: formatAccuracy(averageAccuracy),
        baselineCommitSHA: baselineInfo?.commitSHA || "N/A",
        baselineAccuracyRunId: baselineInfo?.accuracyRunId || "N/A",
        baselineCreatedOn: baselineInfo?.createdOn || "N/A",
        evalsImproved: String(evalsImproved),
        evalsRegressed: String(evalsRegressed),
        tableRows,
    });
}

async function generateTestSummary(): Promise<void> {
    try {
        const accuracyRunId = process.env.MDB_ACCURACY_RUN_ID;
        const baselineCommitSHA = process.env.MDB_ACCURACY_BASELINE_COMMIT;

        if (!accuracyRunId) {
            throw new Error("Cannot generate test summary, accuracy run id is unknown");
        }
        console.log(`\n📊 Generating test summary for accuracy run: ${accuracyRunId}\n`);

        const storage = await getAccuracySnapshotStorage();
        const currentSnapshot = await storage.getSnapshotForAccuracyRun(accuracyRunId);

        if (currentSnapshot.length === 0) {
            console.log("No snapshot entries found for the current run.");
            await storage.close();
            return;
        }

        let snapshotWithBaseline: SnapshotEntryWithBaseline[] = currentSnapshot;
        let baselineInfo: { commitSHA: string; accuracyRunId: string; createdOn: string } | undefined;

        if (baselineCommitSHA) {
            console.log(`🔍 Fetching baseline snapshot entries for commit: ${baselineCommitSHA}`);
            const baselineSnapshot = await storage.getLatestSnapshotForCommit(baselineCommitSHA);

            if (baselineSnapshot.length > 0) {
                console.log(`✅ Found ${baselineSnapshot.length} baseline snapshot entries.`);
                snapshotWithBaseline = compareSnapshotEntries(currentSnapshot, baselineSnapshot);

                const firstBaselineSnapshot = baselineSnapshot[0];
                if (firstBaselineSnapshot) {
                    baselineInfo = {
                        commitSHA: firstBaselineSnapshot.commitSHA,
                        accuracyRunId: firstBaselineSnapshot.accuracyRunId,
                        createdOn: firstBaselineSnapshot.createdOn
                            ? new Date(firstBaselineSnapshot.createdOn).toLocaleString()
                            : "unknown",
                    };
                }
            } else {
                console.log(`⚠️  No baseline snapshots found for commit: ${baselineCommitSHA}`);
            }
        }

        const htmlReport = await generateHtmlReport(snapshotWithBaseline, accuracyRunId, baselineInfo);
        await storage.close();

        const reportPath = HTML_TESTS_SUMMARY_FILE;
        await writeFile(reportPath, htmlReport, "utf8");

        console.log(`✅ HTML report generated: ${reportPath}`);

        const totalPrompts = snapshotWithBaseline.length;
        const modelsCount = new Set(snapshotWithBaseline.map((s) => `${s.provider} ${s.requestedModel}`)).size;
        const testsWithZeroAccuracy = snapshotWithBaseline.filter(
            (snapshotEntry) => snapshotEntry.toolCallingAccuracy === 0
        );
        const evalsImproved = snapshotWithBaseline.filter((s) => s.baseline?.comparisonResult === "improved").length;
        const evalsRegressed = snapshotWithBaseline.filter((s) => s.baseline?.comparisonResult === "regressed").length;

        console.log(`\n📈 Summary:`);
        console.log(`   Total prompts evaluated: ${totalPrompts}`);
        console.log(`   Models tested: ${modelsCount}`);
        console.log(`   Evals with 0% accuracy: ${testsWithZeroAccuracy.length}`);

        if (baselineCommitSHA) {
            console.log(`   Baseline commit: ${baselineCommitSHA}`);
            console.log(`   Evals improved vs baseline: ${evalsImproved}`);
            console.log(`   Evals regressed vs baseline: ${evalsRegressed}`);
        }
    } catch (error) {
        console.error("Error generating test summary:", error);
        process.exit(1);
    }
}

void generateTestSummary();
