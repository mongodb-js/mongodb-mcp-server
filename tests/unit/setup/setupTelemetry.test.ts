import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupTelemetry } from "../../../src/setup/setupTelemetry.js";
import type { Telemetry } from "../../../src/telemetry/telemetry.js";
import type { BaseEvent, SetupEventProperties } from "../../../src/telemetry/types.js";
import type { DeviceId } from "../../../src/helpers/deviceId.js";

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
        setupTelemetry = new SetupTelemetry(mock.telemetry, {
            get: vi.fn().mockResolvedValue("test-device-id"),
            close: vi.fn().mockResolvedValue(undefined),
        } as unknown as DeviceId);
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

    it("should carry accumulated context on every subsequent event", () => {
        setupTelemetry.emitStarted();
        setupTelemetry.emitPrerequisitesChecked({
            nodeVersionOk: true,
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
            stage: "completed",
            ai_tool: "claudeDesktop",
            read_only_mode: "false",
            has_docker: "false",
            node_version_ok: "true",
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

        const connEvent = mock.emitted.find((e) => e.properties.stage === "connection_string_entered");
        expect(connEvent?.properties.result).toBe("failure");
        expect(connEvent?.properties.connection_test_attempts).toBe(3);
    });

    it("should treat skipped connection test as step result=success", () => {
        setupTelemetry.emitStarted();
        setupTelemetry.emitConnectionStringEntered({ provided: true, tested: false, attempts: 0 });

        const connEvent = mock.emitted.find((e) => e.properties.stage === "connection_string_entered");
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

        const editorEvent = mock.emitted.find((e) => e.properties.stage === "editor_configured");
        expect(editorEvent?.properties.result).toBe("failure");
        expect(editorEvent?.properties.error_type).toBe("TypeError");
        expect(editorEvent?.properties.used_default_config_path).toBe("false");
    });

    it("should emit cancelled with last completed step and success result", () => {
        setupTelemetry.emitStarted();
        setupTelemetry.emitAiToolSelected("cursor");
        setupTelemetry.emitCancelled();

        const cancelled = mock.emitted.at(-1)!;
        expect(cancelled.properties.stage).toBe("cancelled");
        expect(cancelled.properties.result).toBe("success");
        expect(cancelled.properties.last_stage).toBe("ai_tool_selected");
        expect(cancelled.properties.ai_tool).toBe("cursor");
    });

    it("should emit failed with error_type and result=failure", () => {
        class MyError extends Error {
            override name = "MyError";
        }
        setupTelemetry.emitStarted();
        setupTelemetry.emitFailed(new MyError("bad"));

        const failed = mock.emitted.at(-1)!;
        expect(failed.properties.stage).toBe("failed");
        expect(failed.properties.result).toBe("failure");
        expect(failed.properties.error_type).toBe("MyError");
    });

    it("should record platformSupported in prerequisites_checked context", () => {
        setupTelemetry.emitPrerequisitesChecked({ nodeVersionOk: true, hasDocker: true, platformSupported: true });
        setupTelemetry.emitCompleted();

        const completed = mock.emitted.at(-1)!;
        expect(completed.properties.platform_supported).toBe("true");
    });

    describe("emitSkillsInstallPrompted", () => {
        it("should record installed status and scope", () => {
            setupTelemetry.emitSkillsInstallPrompted({ status: "installed", scope: "user" });

            const event = mock.emitted.find((e) => e.properties.stage === "skills_install_prompted");
            expect(event?.properties.skills_install_status).toBe("installed");
            expect(event?.properties.skills_install_scope).toBe("user");
            expect(event?.properties.skills_skip_reason).toBeUndefined();
            expect(event?.properties.skills_install_exit_code).toBeUndefined();
        });

        it("should record skipped status and reason", () => {
            setupTelemetry.emitSkillsInstallPrompted({ status: "skipped", reason: "user-declined" });

            const event = mock.emitted.find((e) => e.properties.stage === "skills_install_prompted");
            expect(event?.properties.skills_install_status).toBe("skipped");
            expect(event?.properties.skills_skip_reason).toBe("user-declined");
            expect(event?.properties.skills_install_scope).toBeUndefined();
        });

        it("should record failed status with exit code", () => {
            setupTelemetry.emitSkillsInstallPrompted({ status: "failed", exitCode: 1, scope: "project" });

            const event = mock.emitted.find((e) => e.properties.stage === "skills_install_prompted");
            expect(event?.properties.skills_install_status).toBe("failed");
            expect(event?.properties.skills_install_exit_code).toBe(1);
            expect(event?.properties.skills_install_scope).toBe("project");
        });

        it("should carry skills context onto subsequent events", () => {
            setupTelemetry.emitSkillsInstallPrompted({ status: "installed", scope: "project" });
            setupTelemetry.emitCompleted();

            const completed = mock.emitted.at(-1)!;
            expect(completed.properties.skills_install_status).toBe("installed");
            expect(completed.properties.skills_install_scope).toBe("project");
        });
    });

    it("should flush via telemetry.close()", async () => {
        await setupTelemetry.flush();
        expect(mock.closeMock).toHaveBeenCalledTimes(1);
    });
});
