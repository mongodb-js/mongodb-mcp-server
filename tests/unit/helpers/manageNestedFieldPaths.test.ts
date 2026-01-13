import { describe, expect, it } from "vitest";
import { setFieldPath } from "../../../src/helpers/manageNestedFieldPaths.js";

describe("manageNestedFieldPaths", () => {
    describe("setFieldPath", () => {
        it("sets a top-level field", () => {
            const doc: Record<string, unknown> = {};
            setFieldPath(doc, "name", "test");
            expect(doc).toEqual({ name: "test" });
        });

        it("updates a nested field on existing object", () => {
            const doc: Record<string, unknown> = { info: { title: "Old Title" } };
            setFieldPath(doc, "info.title", "New Title");
            expect(doc).toEqual({ info: { title: "New Title" } });
        });

        it("creates intermediate objects for nested path", () => {
            const doc: Record<string, unknown> = {};
            setFieldPath(doc, "info.titleEmbeddings", [1, 2, 3]);
            expect(doc).toEqual({ info: { titleEmbeddings: [1, 2, 3] } });
        });

        it("creates deeply nested path", () => {
            const doc: Record<string, unknown> = {};
            setFieldPath(doc, "a.b.c.d", "deep value");
            expect(doc).toEqual({ a: { b: { c: { d: "deep value" } } } });
        });

        it("preserves existing sibling fields", () => {
            const doc: Record<string, unknown> = { info: { title: "The Matrix" } };
            setFieldPath(doc, "info.titleEmbeddings", [1, 2, 3]);
            expect(doc).toEqual({ info: { title: "The Matrix", titleEmbeddings: [1, 2, 3] } });
        });

        it("throws when intermediate path is a string", () => {
            const doc: Record<string, unknown> = { info: "string value" };
            expect(() => setFieldPath(doc, "info.title", "test")).toThrow(
                "Cannot set field at provided path: intermediate path 'info' is not an object."
            );
        });

        it("throws when intermediate path is a number", () => {
            const doc: Record<string, unknown> = { info: 123 };
            expect(() => setFieldPath(doc, "info.title", "test")).toThrow(
                "Cannot set field at provided path: intermediate path 'info' is not an object."
            );
        });

        it("throws when intermediate path is an array", () => {
            const doc: Record<string, unknown> = { info: [1, 2, 3] };
            expect(() => setFieldPath(doc, "info.title", "test")).toThrow(
                "Cannot set field at provided path: intermediate path 'info' is not an object."
            );
        });

        it("creates object when intermediate path is null", () => {
            const doc: Record<string, unknown> = { info: null };
            setFieldPath(doc, "info.title", "test");
            expect(doc).toEqual({ info: { title: "test" } });
        });

        it("creates object when intermediate path is undefined", () => {
            const doc: Record<string, unknown> = { info: undefined };
            setFieldPath(doc, "info.title", "test");
            expect(doc).toEqual({ info: { title: "test" } });
        });

        it("sets array as value", () => {
            const doc: Record<string, unknown> = {};
            const embeddings = [0.1, 0.2, 0.3, 0.4];
            setFieldPath(doc, "data.embeddings", embeddings);
            expect(doc).toEqual({ data: { embeddings: [0.1, 0.2, 0.3, 0.4] } });
        });

        it("sets object as value", () => {
            const doc: Record<string, unknown> = {};
            setFieldPath(doc, "metadata", { count: 5, active: true });
            expect(doc).toEqual({ metadata: { count: 5, active: true } });
        });

        describe("prevents prototype pollution", () => {
            it("throws when __proto__ is used as intermediate path", () => {
                const doc: Record<string, unknown> = {};
                expect(() => setFieldPath(doc, "__proto__.polluted", "value")).toThrow(
                    "Cannot set field at provided path: path segment '__proto__' is not allowed."
                );
            });

            it("throws when __proto__ is used as final path", () => {
                const doc: Record<string, unknown> = {};
                expect(() => setFieldPath(doc, "data.__proto__", "value")).toThrow(
                    "Cannot set field at provided path: path segment '__proto__' is not allowed."
                );
            });

            it("throws when constructor is used as path segment", () => {
                const doc: Record<string, unknown> = {};
                expect(() => setFieldPath(doc, "constructor.prototype", "value")).toThrow(
                    "Cannot set field at provided path: path segment 'constructor' is not allowed."
                );
            });

            it("throws when prototype is used as path segment", () => {
                const doc: Record<string, unknown> = {};
                expect(() => setFieldPath(doc, "a.prototype.b", "value")).toThrow(
                    "Cannot set field at provided path: path segment 'prototype' is not allowed."
                );
            });

            it("does not pollute Object.prototype", () => {
                const doc: Record<string, unknown> = {};
                expect(() => setFieldPath(doc, "__proto__.polluted", true)).toThrow();
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
                expect((Object.prototype as any).polluted).toBeUndefined();
            });
        });
    });
});
