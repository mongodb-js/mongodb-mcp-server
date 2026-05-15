/**
 * Parses a single numeric value out of a Prometheus text-format scrape body.
 *
 * Finds the first line whose metric name and label set both match, then
 * returns the trailing numeric value.  Returns `undefined` when no matching
 * line is found.
 *
 * @example
 * parsePrometheusValue(body, "mcp_tool_execution_total", { status: "success" })
 * // → 3
 */
export function parsePrometheusValue(
    body: string,
    metricName: string,
    labels: Record<string, string>
): number | undefined {
    for (const line of body.split("\n")) {
        if (line.startsWith("#") || !line.trim()) {
            continue;
        }

        const braceOpen = line.indexOf("{");
        const braceClose = line.lastIndexOf("}");

        if (braceOpen === -1) {
            if (line.startsWith(metricName + " ") && Object.keys(labels).length === 0) {
                return parseFloat(line.split(" ")[1]!);
            }
            continue;
        }

        if (line.slice(0, braceOpen) !== metricName) {
            continue;
        }

        const parsedLabels: Record<string, string> = {};
        for (const match of line.slice(braceOpen + 1, braceClose).matchAll(/(\w+)="([^"]*)"/g)) {
            parsedLabels[match[1]!] = match[2]!;
        }

        if (Object.entries(labels).every(([k, v]) => parsedLabels[k] === v)) {
            return parseFloat(line.slice(braceClose + 2).trim());
        }
    }
    return undefined;
}
