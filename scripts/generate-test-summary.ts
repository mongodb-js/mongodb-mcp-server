import { readFile, writeFile } from "fs/promises";
import { getAccuracySnapshotStorage } from "../tests/accuracy/sdk/accuracy-snapshot-storage/get-snapshot-storage.js";
import { HTML_TESTS_SUMMARY_FILE, HTML_TESTS_SUMMARY_TEMPLATE } from "../tests/accuracy/sdk/constants.js";
import type {
    AccuracySnapshotEntry,
    ExpectedToolCall,
    LLMToolCall,
} from "../tests/accuracy/sdk/accuracy-snapshot-storage/snapshot-storage.js";

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

async function generateHtmlReport(snapshotEntries: AccuracySnapshotEntry[], accuracyRunId: string): Promise<string> {
    const totalPrompts = snapshotEntries.length;
    const modelsCount = new Set(snapshotEntries.map((s) => `${s.provider} ${s.requestedModel}`)).size;
    const testsWithZeroAccuracy = snapshotEntries.filter((snapshotEntry) => snapshotEntry.toolCallingAccuracy === 0);

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
                    <td class="response-time-cell">${snapshotEntry.llmResponseTime.toFixed(2)}</td>
                    <td class="tokens-cell">${formatTokenUsage(snapshotEntry.tokensUsage || {})}</td>
                </tr>
                <tr class="details-row" id="details-${index}">
                    <td colspan="7">
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

    // Read template file
    const template = await readFile(HTML_TESTS_SUMMARY_TEMPLATE, "utf8");
    // Fill template
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
        tableRows,
    });
}

async function generateTestSummary(): Promise<void> {
    try {
        const accuracyRunId = process.env.MDB_ACCURACY_RUN_ID;
        if (!accuracyRunId) {
            throw new Error("Cannot generate test summary, accuracy run id is unknown");
        }
        console.log(`\n📊 Generating test summary for accuracy run: ${accuracyRunId}\n`);

        const storage = await getAccuracySnapshotStorage();
        const snapshot = await storage.getSnapshotForAccuracyRun(accuracyRunId);
        await storage.close();

        if (snapshot.length === 0) {
            console.log("No snapshots found for the current run.");
            return;
        }

        const htmlReport = await generateHtmlReport(snapshot, accuracyRunId);

        const reportPath = HTML_TESTS_SUMMARY_FILE;
        await writeFile(reportPath, htmlReport, "utf8");

        console.log(`✅ HTML report generated: ${reportPath}`);

        const totalPrompts = snapshot.length;
        const modelsCount = new Set(snapshot.map((s) => `${s.provider} ${s.requestedModel}`)).size;
        const testsWithZeroAccuracy = snapshot.filter((snapshotEntry) => snapshotEntry.toolCallingAccuracy === 0);

        console.log(`\n📈 Summary:`);
        console.log(`   Total prompts evaluated: ${totalPrompts}`);
        console.log(`   Models tested: ${modelsCount}`);
        console.log(`   Evals with 0% accuracy: ${testsWithZeroAccuracy.length}`);
        console.log(`   Report saved to: ${reportPath}\n`);
    } catch (error) {
        console.error("Error generating test summary:", error);
        process.exit(1);
    }
}

void generateTestSummary();
