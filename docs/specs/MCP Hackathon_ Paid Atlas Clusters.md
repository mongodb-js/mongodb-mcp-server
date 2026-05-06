# MCP Hackathon: Paid Atlas Clusters

**2 hours. Real tools. Help us shape how the MCP server creates paid Atlas clusters.**

## Why we're here

The MongoDB MCP Server today only creates free-tier clusters. Closing that gap is formally planned for Q2 (see [MCP-464](https://jira.mongodb.org/browse/MCP-464) for context on the upcoming work). Before we commit to a design, we want **multiple working implementations of two competing approaches** so we can run them through the evals harness and let evidence — success rate, token consumption, behaviour across model sizes — drive the decision instead of opinion.

## Use cases to support

Full evaluation examples: [mdb-atlas-devops-llm-evals/main/cases/case\_8\_mcp\_tool\_strategy](https://github.com/mongodb-labs/mdb-atlas-devops-llm-evals/tree/main/cases/case_8_mcp_tool_strategy) 

### **Simple cluster creation**

* ### **Dev cluster — single-region M10 with best practices** Covered by case\_8 ex1 (all tools) and ex2 (presets\_only). Single-region AWS, M10, compute \+ disk autoscaling enabled, no backup.

* ### **Single-region with bigger requirements** Covered by case\_8 ex3 (full\_crud\_only) — budget production, M30+, single region US\_EAST\_1, autoscaling, backup enabled, cluster paused after creation.

* ### **Multi-region cluster** Covered by case\_8 ex4 (create\_only) — 3+ AWS regions, electable nodes in each, ≥5 total electable nodes, M30+, autoscaling, backup, cluster paused after creation.

### **Cluster management**

* ### Pause cluster Covered by case\_8 ex3 and ex4 as a post-creation step — agent must wait for IDLE then issue pause.

## The two approaches

| Approach A — API-mirroring | Approach B — Curated, task-scoped |
| :---- | :---- |
| Few tools, schemas track the Atlas API closely (create / update / read). General-purpose; the LLM assembles them to fit the user's intent. | More tools, each opinionated and narrow (e.g. "atlas-create-replica-set-cluster", "atlas-pause-cluster"). Abstraction inspirations: Atlas UI flows and the [terraform-mongodbatlas-cluster module](https://github.com/terraform-mongodbatlas-modules/terraform-mongodbatlas-cluster). |

## How the session runs

* Form solo, in pairs, or in small groups, then register your approach (A or B) in Register your group and preferred approach in [MCP Hackathon submissions](https://docs.google.com/spreadsheets/d/1Deui_uUKjykVMwQW4z2_KLo7w7TBjEG61LzhgwknyBQ/edit?gid=0#gid=0).  
  * We're aiming for at least 2 implementations of each.  
      
* Scope is best-effort: aim for a *set* of related tools spanning multiple use cases above.  
    
* **Use AI\!** Point your coding agents at [mongodb-mcp-server/apix-offsite-hackathon/HACKATHON.md](https://github.com/mongodb-js/mongodb-mcp-server/blob/apix-offsite-hackathon/HACKATHON.md) — it has guidelines for streamlining local development.

## What "done" looks like

* **Required:** a fork of [`mongodb-js/mongodb-mcp-server`](https://github.com/mongodb-js/mongodb-mcp-server) with your new tools on a branch.  
* **Strongly encouraged:**  
  * Smoke-test via `pnpm run inspect` against cloud-dev so we know the tool actually creates a cluster.  
  * E2E test: wire your local build into an MCP client (Claude Code, Claude Desktop, Cursor, VS Code) and drive it with a natural-language prompt — e.g. *"Claude, can you tell me what tools the MongoDB MCP has?"*. See [`HACKATHON.md`](https://github.com/mongodb-js/mongodb-mcp-server/blob/apix-offsite-hackathon/HACKATHON.md#53-wiring-your-mcp-client-vs-code--cursor--claude-desktop) for details.

## Where this leads

Implementations get exercised in [`mongodb-labs/mdb-atlas-devops-llm-evals`](https://github.com/mongodb-labs/mdb-atlas-devops-llm-evals); formalized scenarios will be defined there. Measured outcomes — success rate, token consumption, and behaviour across model tiers — will shape how the MCP server expands its tooling and the experience our customers get.

What you build today can directly influence that. Have fun, ship something real.

## Quick links

- Repo to fork: [https://github.com/mongodb-js/mongodb-mcp-server](https://github.com/mongodb-js/mongodb-mcp-server)  
- Hackathon dev guide: [mongodb-mcp-server/tree/apix-offsite-hackathon](https://github.com/mongodb-js/mongodb-mcp-server/tree/apix-offsite-hackathon)   
- Evals harness: [https://github.com/mongodb-labs/mdb-atlas-devops-llm-evals](https://github.com/mongodb-labs/mdb-atlas-devops-llm-evals)