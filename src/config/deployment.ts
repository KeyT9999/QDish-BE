export const getDeploymentCommit = (
  environment: NodeJS.ProcessEnv = process.env
): string | null => environment.RENDER_GIT_COMMIT || environment.GIT_COMMIT_SHA || null;
