import { simpleGit } from "simple-git";

export async function getCommitSHA(): Promise<string | undefined> {
    const commitLogs = await simpleGit().log();
    const lastCommit = commitLogs.latest;
    return lastCommit?.hash;
}
