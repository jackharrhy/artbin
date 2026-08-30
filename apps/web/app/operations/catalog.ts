import { z } from "zod";

import type { OperationContext } from "./context.ts";
import {
  createFoldersOperation,
  folderCreateInput,
  folderListInput,
  folderManageInput,
  listFoldersOperation,
  manageFolderOperation,
} from "./folders.ts";
import { jobListInput, jobManageInput, listJobsOperation, manageJobOperation } from "./jobs.ts";
import { importQueueInput, queueImportOperation } from "./imports.ts";

type OperationDefinition<S extends z.ZodType, O> = {
  mcpName: string;
  description: string;
  input: S;
  execute(context: OperationContext, input: unknown): Promise<O>;
};

function defineOperation<S extends z.ZodType, O>(definition: {
  mcpName: string;
  description: string;
  input: S;
  run(context: OperationContext, input: z.output<S>): O | Promise<O>;
}): OperationDefinition<S, O> {
  return {
    mcpName: definition.mcpName,
    description: definition.description,
    input: definition.input,
    execute: (context, input) =>
      Promise.resolve(definition.run(context, definition.input.parse(input))),
  };
}

export const operationCatalog = {
  foldersList: defineOperation({
    mcpName: "artbin_folders_list",
    description: "List folders or inspect one folder. Administrators may include system folders.",
    input: folderListInput,
    run: listFoldersOperation,
  }),
  foldersCreate: defineOperation({
    mcpName: "artbin_folders_create",
    description: "Create one or more folders as the authenticated Artbin administrator.",
    input: folderCreateInput,
    run: createFoldersOperation,
  }),
  folderManage: defineOperation({
    mcpName: "artbin_folder_manage",
    description: "Plan or apply a folder rename or move. Use dryRun=true before applying changes.",
    input: folderManageInput,
    run: manageFolderOperation,
  }),
  jobsList: defineOperation({
    mcpName: "artbin_jobs_list",
    description: "List Artbin background jobs and identify jobs that appear stuck.",
    input: jobListInput,
    run: listJobsOperation,
  }),
  jobManage: defineOperation({
    mcpName: "artbin_job_manage",
    description: "Cancel, reset, or delete a background job. Requires confirm=true.",
    input: jobManageInput,
    run: manageJobOperation,
  }),
  importQueue: defineOperation({
    mcpName: "artbin_import_queue",
    description: "Queue a remote, local-folder, preview-regeneration, or built-in catalog import.",
    input: importQueueInput,
    run: queueImportOperation,
  }),
} as const;

export const mcpOperations = new Map(
  Object.values(operationCatalog).map((operation) => [operation.mcpName, operation]),
);

export const mcpTools = Object.values(operationCatalog).map((operation) => ({
  name: operation.mcpName,
  description: operation.description,
  inputSchema: z.toJSONSchema(operation.input, { target: "draft-7" }),
}));
