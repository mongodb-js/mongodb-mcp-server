import { ToolBase, ToolCategory } from "../tool.js";
import { Session } from "../../session.js";

export abstract class AtlasToolBase extends ToolBase {
    constructor(protected readonly session: Session) {
        super(session);
    }

    protected category: ToolCategory = "atlas";
}
