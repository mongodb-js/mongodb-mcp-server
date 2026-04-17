import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupTelemetry } from "../../../src/setup/setupTelemetry.js";
import type { Telemetry } from "../../../src/telemetry/telemetry.js";
import type { BaseEvent, SetupEventProperties } from "../../../src/telemetry/types.js";

type EmittedEvent = BaseEvent & { properties: SetupEventProperties };

function createMockTelemetry(): {
    telemetry: Telemetry;
    emitted: EmittedEvent[];
    closeMock: ReturnType<typeof vi.fn>;
} {
    const emitted: EmittedEvent[] = [];
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const telemetry = {
        emitEvents: vi.fn().mockImplementation((events: EmittedEvent[]) => {
            emitted.push(...events);
        }),
        close: closeMock,
    } as unknown as Telemetry;
    return { telemetry, emitted, closeMock };
}

describe("SetupTelemetry", () => {
    let mock: ReturnType<typeof createMockTelemetry>;
    let setupTelemetry: SetupTelemetry;

    beforeEach(() => {
        mock = createMockTelemetry();
        setupTelemetry = new SetupTelemetry(mock.telemetry);
    });

    it("should emit events with component=setup and category=setup", () => {
        setupTelemetry.emitStarted();

        expect(mock.emitted).toHaveLength(1);
        expect(mock.emitted[0]!.properties.component).toBe("setup");
        expect(mock.emitted[0]!.properties.category).toBe("setup");
        expect(mock.emitted[0]!.source).toBe("mdbmcp");
    });

    it("should assign a stable setup_session_id across a run", () => {
        setupTelemetry.emitStarted();
        setupTelemetry.emitAiToolSelected("cursor");
        setupTelemetry.emitCompleted();

        const ids = mock.emitted.map((e) => e.properties.setup_session_id);
        expect(new Set(ids).size).toBe(1);
        expect(ids[0]).toMatch(/^[0-9a-f-]+$/);
    });

    it("should increment step_index monotonically", () => {
        setupTelemetry.emitStarted();
        setupTelemetry.emitAiToolSelected("vscode");
        setupTelemetry.emitReadOnlySelected(true);
        setupTelemetry.emitCompleted();

        expect(mock.emitted.map((e) => e.properties.step_index)).toEqual([0, 1, 2, 3]);
    });

    it("should carry accumulated context on every subsequent event", () => {
        setupTelemetry.emitStarted();
        setupTelemetry.emitPrerequisitesChecked({
            nodeVersionOk: true,
            platformSupported: true,
            hasDocker: false,
        });
        setupTelemetry.emitAiToolSelected("claudeDesktop");
        setupTelemetry.emitReadOnlySelected(false);
        setupTelemetry.emitConnectionStringEntered({
            provided: true,
            tested: true,
            attempts: 2,
            testResult: "success",
        });
        setupTelemetry.emitCompleted();

        const completed = mock.emitted.at(-1)!;
        expect(completed.properties).toMatchObject({
            command: "completed",
            ai_tool: "claudeDesktop",
            is_read_only: "false",
            has_docker: "false",
            node_version_ok: "true",
            platform_supported: "true",
            connection_string_provided: "true",
            connection_string_tested: "true",
            connection_test_attempts: 2,
            result: "success",
        });
        expect(typeof completed.properties.total_duration_ms).toBe("number");
    });

    it("should record connection test failure as step result=failure", () => {
        setupTelemetry.emitStarted();
        setupTelemetry.emitConnectionStringEntered({
            provided: true,
            tested: true,
            attempts: 3,
            testResult: "failure",
        });

        const connEvent = mock.emitted.find((e) => e.properties.command === "connection_string_entered");
        expect(connEvent?.properties.result).toBe("failure");
        expect(connEvent?.properties.connection_test_attempts).toBe(3);
    });

    it("should treat skipped connection test as step result=success", () => {
        setupTelemetry.emitStarted();
        setupTelemetry.emitConnectionStringEntered({ provided: true, tested: false, attempts: 0 });

        const connEvent = mock.emitted.find((e) => e.properties.command === "connection_string_entered");
        expect(connEvent?.properties.result).toBe("success");
        expect(connEvent?.properties.connection_string_tested).toBe("false");
    });

    it("should record editor configuration failure with result=failure and error_type", () => {
        const boom = new TypeError("oops");
        setupTelemetry.emitStarted();
        setupTelemetry.emitEditorConfigured({
            usedDefaultConfigPath: false,
            result: "failure",
            error: boom,
        });

        const editorEvent = mock.emitted.find((e) => e.properties.command === "editor_configured");
        expect(editorEvent?.properties.result).toBe("failure");
        expect(editorEvent?.properties.error_type).toBe("TypeError");
        expect(editorEvent?.properties.used_default_config_path).toBe("false");
    });

    it("should emit cancelled with last completed step and success result", () => {
        setupTelemetry.emitStarted();
        setupTelemetry.emitAiToolSelected("cursor");
        setupTelemetry.emitCancelled();

        const cancelled = mock.emitted.at(-1)!;
        expect(cancelled.properties.command).toBe("cancelled");
        expect(cancelled.properties.result).toBe("success");
        expect(cancelled.properties.last_step).toBe("ai_tool_selected");
        expect(cancelled.properties.ai_tool).toBe("cursor");
    });

    it("should emit failed with error_type and result=failure", () => {
        class MyError extends Error {
            override name = "MyError";
        }
        setupTelemetry.emitStarted();
        setupTelemetry.emitFailed(new MyError("bad"));

        const failed = mock.emitted.at(-1)!;
        expect(failed.properties.command).toBe("failed");
        expect(failed.properties.result).toBe("failure");
        expect(failed.properties.error_type).toBe("MyError");
    });

    it("should flush via telemetry.close()", async () => {
        await setupTelemetry.flush();
        expect(mock.closeMock).toHaveBeenCalledTimes(1);
    });
});
