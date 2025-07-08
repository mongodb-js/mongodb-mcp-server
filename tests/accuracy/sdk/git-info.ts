import { simpleGit } from "simple-git";

export async function getCommitSHA(): Promise<string | undefined> {
    const commitLogs = await simpleGit().log();
    const lastCommit = commitLogs.latest;
    return lastCommit?.hash;
}

export async function getMergeBase(targetBranch: string, workBranchOrCommit: string): Promise<string> {
    const result = await simpleGit().raw(["merge-base", targetBranch, workBranchOrCommit]);
    return result.trim();
}
