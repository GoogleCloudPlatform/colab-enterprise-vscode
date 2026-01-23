/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { JupyterServer } from "@vscode/jupyter-extension";
import type vscode from "vscode";
import { InputStep, MultiStepInput } from "../common/multi-step-quickpick";
import { WorkbenchInstanceManager } from "../jupyter/workbench-instance-manager";
import { GCPProject, ProjectsClient } from "./projects-client";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Handles the Workbench project selection command.
 */
export async function selectProjectCommand(
  vs: typeof vscode,
  projectsClient: ProjectsClient,
  instanceManager: WorkbenchInstanceManager,
): Promise<JupyterServer | undefined> {
  try {
    let selectedProject: vscode.QuickPickItem | undefined;

    const pickProject: InputStep = async (input) => {
      let searchTimeout: NodeJS.Timeout | undefined;

      // Initial load
      let initialItems: vscode.QuickPickItem[] = [];
      try {
        const projects = await projectsClient.getProjects();
        initialItems = projects.map((p: GCPProject) => ({
          label: p.name,
          detail: p.id,
          description: p.id !== p.name ? p.id : undefined,
        }));
      } catch (error: unknown) {
        console.error("Failed to fetch initial projects:", error);
      }

      selectedProject = await input.showQuickPick<vscode.QuickPickItem>({
        title: "Select a Google Cloud Project",
        step: 1,
        totalSteps: 2,
        placeholder: "Select a Google Cloud Project",
        items: initialItems,
        onDidChangeValue: (value, quickPick) => {
          if (searchTimeout) {
            clearTimeout(searchTimeout);
          }
          searchTimeout = setTimeout(() => {
            const qp = quickPick as vscode.QuickPick<vscode.QuickPickItem>;
            void updateProjectList(projectsClient, qp, value).catch(
              (err: unknown) => {
                console.error("Unhandled promise rejection in timeout:", err);
              },
            );
          }, SEARCH_DEBOUNCE_MS);
        },
      });

      return undefined;
    };

    await MultiStepInput.run(vs, pickProject);
    if (selectedProject?.detail) {
      instanceManager.setProjectId(selectedProject.detail);
    }
  } catch (error: unknown) {
    // If the user cancelled, MultiStepInput throws InputFlowAction.cancel
    // Actually MultiStepInput swallows cancel and returns normally.
    // So if cancelled, selectedServer stays undefined.
    // If error occurs, we show message.
    if (error instanceof Error && error.message === "cancel") {
      return;
    }

    // We should probably catch other errors
    const errMessage = error instanceof Error ? error.message : String(error);
    if (errMessage === "cancel") {
      return;
    }
    void vs.window.showErrorMessage(
      `Failed to start Workbench flow: ${errMessage}`,
    );
  }
  return;
}

async function updateProjectList(
  projectsClient: ProjectsClient,
  quickPick: vscode.QuickPick<vscode.QuickPickItem>,
  value: string,
): Promise<void> {
  quickPick.busy = true;
  try {
    const projects = await projectsClient.getProjects(value);
    quickPick.items = projects.map((p) => ({
      label: p.name,
      detail: p.id,
      description: p.id !== p.name ? p.id : undefined,
    }));
  } catch (error: unknown) {
    console.error("Failed to fetch projects:", error);
  } finally {
    quickPick.busy = false;
  }
}
