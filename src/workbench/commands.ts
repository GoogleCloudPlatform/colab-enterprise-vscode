/**
 * @license
 * Copyright 2025 Google LLC
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
        const projects = await projectsClient.getProjects("");
        initialItems = projects.map((p: GCPProject) => ({
          label: p.name,
          detail: p.id,
          description: p.id !== p.name ? p.id : undefined,
        }));
      } catch (error) {
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
            void (async () => {
              const qp = quickPick as vscode.QuickPick<vscode.QuickPickItem>;
              qp.busy = true;
              try {
                const projects = await projectsClient.getProjects(value);
                qp.items = projects.map((p: GCPProject) => ({
                  label: p.name,
                  detail: p.id,
                  description: p.id !== p.name ? p.id : undefined,
                }));
              } catch (error) {
                console.error("Failed to fetch projects:", error);
              } finally {
                qp.busy = false;
              }
            })().catch((err: unknown) => {
              console.error("Unhanded promise rejection in timeout:", err);
            });
          }, SEARCH_DEBOUNCE_MS);

        },
      });

      return;
    };

    await MultiStepInput.run(vs, pickProject);
    if (selectedProject && selectedProject.detail) {
      instanceManager.setProjectId(selectedProject.detail);
    }
  } catch (error) {
    // If the user cancelled, MultiStepInput throws InputFlowAction.cancel
    // Actually MultiStepInput swallows cancel and returns normally.
    // So if cancelled, selectedServer stays undefined.
    // If error occurs, we show message.
    if (error instanceof Error && error.message === 'cancel') {
      return;
    }

    // We should probably catch other errors
    const errMessage = error instanceof Error ? error.message : String(error);
    if (errMessage !== "cancel") {
      void vs.window.showErrorMessage(
        `Failed to start Workbench flow: ${errMessage}`,
      );
    }
    return;
  }
}
