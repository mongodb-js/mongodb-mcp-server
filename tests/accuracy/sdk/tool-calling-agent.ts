import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createToolCallingAgent, AgentExecutor } from "langchain/agents";

import { LangChainTool } from "./test-tools.js";
import { AcceptableToolResponse, Model } from "./models.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

const prompt = ChatPromptTemplate.fromMessages([
    [
        "system",
        [
            'The keywords "MUST", "MUST NOT", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119 (https://www.ietf.org/rfc/rfc2119.txt)',
            "You are an expect AI assistant with access to a set of tools for MongoDB database operations.",
            "You MUST use the most relevant tool to answer the user's request",
            "When calling a tool, you MUST strictly follow its input schema and MUST provide all required arguments",
            "If a task requires multiple steps, you MUST call the necessary tools in sequence",
            'If you do not know the answer or the request cannot be fulfilled, you MUST reply with "I don\'t know"',
        ].join("\n"),
    ],
    ["human", "{input}"],
    ["placeholder", "{agent_scratchpad}"],
]);

export function getToolCallingAgent<T extends AcceptableToolResponse>(
    model: Model<BaseChatModel, T>,
    tools: LangChainTool<T>[]
) {
    const llm = model.getLangChainModel();
    const agent = createToolCallingAgent({
        llm,
        tools,
        prompt,
    });
    const agentExecutor = new AgentExecutor({ agent, tools });
    return agentExecutor;
}
